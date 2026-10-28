<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import IconifyIcon from '#/components/IconifyIcon.vue';

import {
  armReminder,
  cancelReminder,
  claimReminderFire,
  hasArmedReminder,
  initReminderEngine,
  playCloudVoice,
  playReminderNow,
  prepareCloudVoice,
  showReminderNotification,
  speakReminder,
  unlockReminderAudio,
} from './focus-reminder-engine';
import { loadReminderPrefs } from './focus-reminder-prefs';
import { useStudyRoomState, scheduleSaveStudyRoom } from './study-room-state-store';

const { state } = useStudyRoomState();

type TimerMode = 'focus' | 'break';

interface TimerSnapshot {
  mode: TimerMode;
  round: number;
  completed: number;
  focusMinutes: number;
  breakMinutes: number;
  isRunning: boolean;
  remaining: number;
  expiresAt: number | null;
  sessionId: string;
}

const props = withDefaults(
  defineProps<{
    focusMinutes?: number;
    breakMinutes?: number;
    immersive?: boolean;
  }>(),
  {
    focusMinutes: 25,
    breakMinutes: 5,
    immersive: false,
  },
);

const STORAGE_KEY = 'qingyan-study-room:pomodoro:v1';

const mode = ref<TimerMode>('focus');
const round = ref(1);
const completed = ref(0);
const isRunning = ref(false);
const remaining = ref(props.focusMinutes * 60);
const hydrated = ref(false);

let interval: ReturnType<typeof setInterval> | null = null;
let expiresAt: number | null = null;
let sessionId = createSessionId();
let originalTitle = '';
let titleFlashing = false;
/** 本轮提醒的播报权：多标签页同时开着时只让一个页面出声。 */
let fireClaimed = false;
let fireKey = '';
let spokenKey = '';
let firedAt = 0;
let firedMode: TimerMode = 'focus';
let removeUnlockListener: (() => void) | null = null;

function createSessionId() {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `focus-${id}`;
}

function secondsUntil(deadline: number) {
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}

function load(): TimerSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || typeof value !== 'object') return null;
    const ok =
      (value.mode === 'focus' || value.mode === 'break') &&
      Number.isInteger(value.round) &&
      Number(value.round) >= 1 &&
      Number.isInteger(value.completed) &&
      Number(value.completed) >= 0 &&
      Number.isFinite(value.focusMinutes) &&
      Number(value.focusMinutes) > 0 &&
      Number.isFinite(value.breakMinutes) &&
      Number(value.breakMinutes) > 0 &&
      typeof value.isRunning === 'boolean' &&
      Number.isInteger(value.remaining) &&
      Number(value.remaining) >= 0;
    if (!ok) return null;
    return {
      mode: value.mode as TimerMode,
      round: Number(value.round),
      completed: Number(value.completed),
      focusMinutes: Number(value.focusMinutes),
      breakMinutes: Number(value.breakMinutes),
      isRunning: value.isRunning as boolean,
      remaining: Number(value.remaining),
      expiresAt: typeof value.expiresAt === 'number' ? value.expiresAt : null,
      sessionId: typeof value.sessionId === 'string' ? value.sessionId : createSessionId(),
    };
  } catch {
    return null;
  }
}

function save(snapshot: TimerSnapshot) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // 本地存储不可用时静默降级。
  }
}

function persist() {
  save({
    mode: mode.value,
    round: round.value,
    completed: completed.value,
    focusMinutes: props.focusMinutes,
    breakMinutes: props.breakMinutes,
    isRunning: isRunning.value,
    remaining: remaining.value,
    expiresAt,
    sessionId,
  });
}

function flashTitle() {
  if (titleFlashing) return;
  titleFlashing = true;
  document.title = '该休息啦 · 栖心自习室';
}

function restoreTitle() {
  if (!titleFlashing) return;
  titleFlashing = false;
  document.title = originalTitle || '栖心自习室';
}

/**
 * 播报提示。到点这一刻绝不等待网络：已经缓存好的云端音频直接用，
 * 否则立刻用浏览器语音兜底，同时后台补取云端音频留给下一轮。
 */
function speakNow(prefs: ReturnType<typeof loadReminderPrefs>) {
  if (!prefs.text.trim()) return false;
  if (prefs.voiceSource === 'cloud') {
    if (playCloudVoice(prefs.text, prefs)) return true;
    void prepareCloudVoice(prefs.text, prefs);
  }
  return speakReminder(prefs.text, prefs);
}

/** 把提示音与到点回调排到音频时间轴上：隐藏标签页里主线程定时器被降频也能准点响。 */
function armReminderForRound() {
  const prefs = loadReminderPrefs();
  if (!prefs.enabled || expiresAt === null) {
    cancelReminder();
    return;
  }
  unlockReminderAudio();
  const withVoice = mode.value === 'focus';
  // 云端合成有延迟，开跑时先把这段话说好备着；链路会抖，失败就再试一次。
  if (withVoice && prefs.useVoice && prefs.voiceSource === 'cloud') {
    void prepareCloudVoice(prefs.text, prefs).then((ready) => {
      if (!ready) void prepareCloudVoice(prefs.text, prefs);
    });
  }
  armReminder(expiresAt, prefs.sound, {
    onDue: () => handleExpire(),
    onSpeak: () => {
      if (!fireClaimed) return;
      const current = loadReminderPrefs();
      if (!current.enabled || !current.useVoice || !withVoice) return;
      if (speakNow(current)) spokenKey = fireKey;
    },
  });
}

function recordCompletedFocusSession(minutes: number) {
  // 完整专注结束后写入本地 focus_sessions，供主页统计。
  const sessions = state.value.focus_sessions ?? [];
  const last = sessions[sessions.length - 1];
  if (last && last.sessionId === sessionId) return;
  state.value.focus_sessions = [
    ...sessions,
    { minutes, sessionId, createdAt: new Date().toISOString() },
  ];
  scheduleSaveStudyRoom();
}

function handleExpire() {
  // 音频回调与主线程定时器可能同时到达，只处理一次。
  if (!isRunning.value) return;
  const wasFocus = mode.value === 'focus';
  const key = `${sessionId}:${wasFocus ? 'focus' : 'break'}`;
  fireKey = key;
  const prefs = loadReminderPrefs();
  fireClaimed = claimReminderFire(key);

  if (prefs.enabled && fireClaimed && wasFocus) {
    if (prefs.useNotification) {
      showReminderNotification('专注完成啦', prefs.text.trim() || '该休息一下了');
    }
    flashTitle();
  }
  // 提示音没排上（比如音频被浏览器拦着）时立刻补一声。
  if (prefs.enabled && !hasArmedReminder() && prefs.sound !== 'none') {
    playReminderNow(prefs.sound);
  }

  if (wasFocus) {
    completed.value += 1;
    recordCompletedFocusSession(props.focusMinutes);
  } else {
    round.value += 1;
    sessionId = createSessionId();
  }
  mode.value = wasFocus ? 'break' : 'focus';
  remaining.value = (wasFocus ? props.breakMinutes : props.focusMinutes) * 60;
  isRunning.value = false;
  expiresAt = null;
  firedAt = Date.now();
  firedMode = wasFocus ? 'focus' : 'break';
  persist();
}

function start() {
  if (remaining.value <= 0) {
    remaining.value =
      (mode.value === 'focus' ? props.focusMinutes : props.breakMinutes) * 60;
  }
  expiresAt = Date.now() + remaining.value * 1000;
  isRunning.value = true;
  fireClaimed = false;
  fireKey = '';
  spokenKey = '';
  firedAt = 0;
  firedMode = mode.value;
  restoreTitle();
  persist();
  armReminderForRound();
}

function pause() {
  if (expiresAt !== null) {
    remaining.value = secondsUntil(expiresAt);
  }
  expiresAt = null;
  isRunning.value = false;
  restoreTitle();
  persist();
  cancelReminder();
}

function reset() {
  remaining.value = props.focusMinutes * 60;
  sessionId = createSessionId();
  expiresAt = null;
  isRunning.value = false;
  mode.value = 'focus';
  round.value = 1;
  completed.value = 0;
  restoreTitle();
  persist();
  cancelReminder();
}

function skip() {
  const wasFocus = mode.value === 'focus';
  if (wasFocus) {
    mode.value = 'break';
    remaining.value = props.breakMinutes * 60;
  } else {
    mode.value = 'focus';
    round.value += 1;
    remaining.value = props.focusMinutes * 60;
    sessionId = createSessionId();
  }
  expiresAt = null;
  isRunning.value = false;
  restoreTitle();
  persist();
  cancelReminder();
}

function toggle() {
  // 直接开始/暂停计时，不触发沉浸模式（沉浸由独立按钮进入）
  if (isRunning.value) {
    pause();
  } else {
    start();
  }
}

function clearTimer() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}

function onVisibility() {
  if (document.hidden) return;
  restoreTitle();
  // 语音在后台标签页可能没播出来，回到前台补播一次（只有专注轮才需要播报）。
  if (!fireClaimed || !firedAt || spokenKey === fireKey) return;
  if (firedMode !== 'focus') return;
  if (Date.now() - firedAt > 120_000) return;
  const prefs = loadReminderPrefs();
  if (!prefs.enabled || !prefs.useVoice || !prefs.text.trim()) return;
  if (speakNow(prefs)) spokenKey = fireKey;
}

onMounted(() => {
  initReminderEngine();
  originalTitle = document.title;
  const snapshot = load();
  if (snapshot) {
    mode.value = snapshot.mode;
    round.value = snapshot.round;
    completed.value = snapshot.completed;
    sessionId = snapshot.sessionId;
    if (snapshot.isRunning) {
      const deadline = snapshot.expiresAt ?? Date.now() + snapshot.remaining * 1000;
      const restored = secondsUntil(deadline);
      if (restored > 0) {
        remaining.value = restored;
        expiresAt = deadline;
        isRunning.value = true;
        armReminderForRound();
      } else {
        // 已过期：结算并切到下一阶段
        if (snapshot.mode === 'focus') {
          completed.value += 1;
          recordCompletedFocusSession(props.focusMinutes);
        } else {
          round.value += 1;
          sessionId = createSessionId();
        }
        mode.value = snapshot.mode === 'focus' ? 'break' : 'focus';
        remaining.value =
          (snapshot.mode === 'focus' ? snapshot.breakMinutes : snapshot.focusMinutes) * 60;
        isRunning.value = false;
        expiresAt = null;
      }
    } else {
      // 未运行时：时长设置没变就恢复暂停时的剩余时间，否则以当前 props 为准，
      // 否则选了 45 分钟仍显示 25:00。
      const sameDuration =
        snapshot.focusMinutes === props.focusMinutes &&
        snapshot.breakMinutes === props.breakMinutes;
      const total =
        (mode.value === 'focus' ? props.focusMinutes : props.breakMinutes) * 60;
      remaining.value =
        sameDuration && snapshot.remaining > 0
          ? Math.min(snapshot.remaining, total)
          : total;
    }
  }
  hydrated.value = true;
  // 全新进入沉浸模式且此前没有计时记录时自动开始；已有记录时保持原来的运行/暂停状态。
  if (props.immersive && !isRunning.value && !snapshot) {
    start();
  }
  // 浏览器自动播放策略：首次交互后解锁音频，并给正在运行的计时补排提示音。
  const unlock = () => {
    unlockReminderAudio();
    if (isRunning.value && !hasArmedReminder()) armReminderForRound();
    document.removeEventListener('pointerdown', unlock);
    document.removeEventListener('keydown', unlock);
  };
  document.addEventListener('pointerdown', unlock);
  document.addEventListener('keydown', unlock);
  document.addEventListener('visibilitychange', onVisibility);
  removeUnlockListener = () => {
    document.removeEventListener('pointerdown', unlock);
    document.removeEventListener('keydown', unlock);
  };
});

watch(
  () => [props.focusMinutes, props.breakMinutes],
  () => {
    if (!hydrated.value) return;
    if (!isRunning.value) {
      remaining.value =
        (mode.value === 'focus' ? props.focusMinutes : props.breakMinutes) * 60;
      persist();
    }
  },
);

watch(
  isRunning,
  (running) => {
    clearTimer();
    if (!running) return;
    interval = setInterval(() => {
      if (expiresAt === null) {
        expiresAt = Date.now() + remaining.value * 1000;
      }
      const next = secondsUntil(expiresAt);
      if (next <= 0) {
        handleExpire();
        return;
      }
      if (next !== remaining.value) {
        remaining.value = next;
      }
    }, 250);
  },
);

onBeforeUnmount(() => {
  clearTimer();
  removeUnlockListener?.();
  document.removeEventListener('visibilitychange', onVisibility);
});

const totalSeconds = computed(() =>
  (mode.value === 'focus' ? props.focusMinutes : props.breakMinutes) * 60,
);
const progress = computed(() =>
  totalSeconds.value > 0 ? 1 - remaining.value / totalSeconds.value : 0,
);
const timeDisplay = computed(() => {
  const min = Math.floor(remaining.value / 60);
  const sec = remaining.value % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
});

// 环形进度 SVG 常量
const RING_RADIUS = 108;
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const SVG_SIZE = 260;
const SVG_CENTER = SVG_SIZE / 2;
const dashOffset = computed(() => CIRCUMFERENCE * (1 - progress.value));
</script>

<template>
  <div v-if="immersive" class="immersive-timer-display">
    <span class="immersive-timer">{{ timeDisplay }}</span>
  </div>

  <div v-else class="focus-timer">
    <div class="timer-ring-wrap">
      <svg :width="SVG_SIZE" :height="SVG_SIZE" class="timer-ring-svg" :viewBox="`0 0 ${SVG_SIZE} ${SVG_SIZE}`">
        <circle
          :cx="SVG_CENTER"
          :cy="SVG_CENTER"
          :r="RING_RADIUS"
          fill="none"
          stroke="rgb(255 255 255 / 0.06)"
          stroke-width="5"
        />
        <circle
          :cx="SVG_CENTER"
          :cy="SVG_CENTER"
          :r="RING_RADIUS"
          fill="none"
          stroke="var(--study-room-primary)"
          stroke-width="5"
          stroke-linecap="round"
          :stroke-dasharray="CIRCUMFERENCE"
          :stroke-dashoffset="dashOffset"
          style="filter: drop-shadow(0 0 12px color-mix(in srgb, var(--study-room-primary) 50%, transparent)); transition: stroke-dashoffset 0.5s linear;"
        />
      </svg>
      <div class="timer-ring-center">
        <span class="timer-mode-label">Round {{ round }} · {{ mode === 'focus' ? '专注' : '休息' }}</span>
        <span class="timer-time">{{ timeDisplay }}</span>
      </div>
    </div>

    <div class="timer-controls">
      <button type="button" class="timer-btn" aria-label="重置" @click="reset">
        <IconifyIcon icon="lucide:rotate-ccw" />
      </button>
      <button type="button" class="timer-btn timer-btn-primary" :aria-label="isRunning ? '暂停' : '开始'" @click="toggle">
        <IconifyIcon :icon="isRunning ? 'lucide:pause' : 'lucide:play'" />
      </button>
      <button type="button" class="timer-btn" aria-label="跳过" @click="skip">
        <IconifyIcon icon="lucide:skip-forward" />
      </button>
    </div>

    <div v-if="completed > 0" class="timer-dots">
      <span v-for="i in Math.min(completed, 8)" :key="i" class="timer-dot" />
      <span v-if="completed > 8" class="timer-dot-count">×{{ completed }}</span>
    </div>
  </div>
</template>

<style scoped>
.focus-timer {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.timer-ring-wrap {
  position: relative;
}

.timer-ring-svg {
  transform: rotate(-90deg);
}

.timer-ring-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.timer-mode-label {
  font-size: 12px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: rgb(255 255 255 / 0.5);
}

.timer-time {
  font-size: 56px;
  font-weight: 200;
  line-height: 1;
  color: #fff;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

.timer-controls {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-top: 32px;
}

.timer-btn {
  display: flex;
  width: 48px;
  height: 48px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  color: rgb(255 255 255 / 0.6);
  background: rgb(255 255 255 / 0.05);
  cursor: pointer;
  transition: all 0.18s ease;
}

.timer-btn:hover {
  color: #fff;
  background: rgb(255 255 255 / 0.1);
}

.timer-btn-primary {
  width: 64px;
  height: 64px;
  color: #051612;
  background: var(--study-room-primary);
  box-shadow: 0 0 24px color-mix(in srgb, var(--study-room-primary) 45%, transparent);
}

.timer-btn-primary:hover {
  background: var(--study-room-primary);
  transform: scale(1.05);
}

.timer-dots {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 20px;
}

.timer-dot {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--study-room-primary) 70%, transparent);
}

.timer-dot-count {
  margin-left: 4px;
  font-size: 12px;
  color: rgb(255 255 255 / 0.5);
}

.immersive-timer-display {
  display: flex;
  align-items: center;
  justify-content: center;
}

.immersive-timer {
  font-size: 128px;
  font-weight: 700;
  line-height: 1;
  color: var(--study-room-primary);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
  user-select: none;
  text-shadow:
    0 0 60px color-mix(in srgb, var(--study-room-primary) 28%, transparent),
    0 10px 40px rgb(0 0 0 / 0.34);
}

@media (max-width: 767px) {
  .immersive-timer {
    font-size: 72px;
  }
}
</style>
