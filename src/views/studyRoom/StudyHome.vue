<script lang="ts" setup>
import { computed, reactive, ref } from 'vue';

import { ElButton, ElDialog, ElInput, ElMessage } from 'element-plus';

import defaultAvatarImg from '#/assets/defaultUserAvatar.png';
import IconifyIcon from '#/components/IconifyIcon.vue';
import { exportBackup, importBackup } from '#/lib/backup';
import {
  fileToAvatarDataUrl,
  sanitizeAvatar,
  saveLocalUser,
  useLocalUser,
} from '#/lib/local-user';
import { STATIC_MODE } from '#/lib/app-mode';
import { displayAvatar, displayNickname } from '#/lib/display-identity';
import { account } from '#/session/session-state';
import {
  retrySync,
  useStudyRoomState,
  type SyncStatus,
} from './study-room-state-store';
import type { StudyRoomFocusSession } from './study-room-types';
import {
  calcStreak,
  dateKeyOf,
  todayKey,
  type StudyRoomCheckin,
} from './study-room-store';

const YEAR_GOAL = 365;

const { state, syncStatus, error: syncError } = useStudyRoomState();
const { profile } = useLocalUser();

// ── 编辑资料弹窗 ──
const profileEditVisible = ref(false);
const defaultAvatar = defaultAvatarImg;
const profileForm = reactive({
  avatar: '',
  nickname: '',
});

function openProfileEditor() {
  // 打开时填界面正在显示的名字，避免弹窗里出现另一个名字。
  profileForm.nickname = userNickname.value;
  // 本机默认头像资源路径不写入资料，留空时会回退到 Qoder 头像。
  profileForm.avatar = sanitizeAvatar(profile.avatar);
  profileEditVisible.value = true;
}

async function onAvatarChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    ElMessage.warning('请选择图片文件');
    input.value = '';
    return;
  }
  try {
    profileForm.avatar = await fileToAvatarDataUrl(file);
  } catch {
    ElMessage.error('头像处理失败，请换一张图片');
  } finally {
    input.value = '';
  }
}

function saveProfile() {
  if (!profileForm.nickname.trim()) {
    ElMessage.warning('请输入昵称');
    return;
  }
  try {
    saveLocalUser({
      nickname: profileForm.nickname.trim(),
      // 留空表示使用 Qoder 头像，云端不接受本机默认头像路径。
      avatar: profileForm.avatar,
    });
  } catch (caught) {
    ElMessage.error(caught instanceof Error ? caught.message : '资料保存失败');
    return;
  }
  profileEditVisible.value = false;
  ElMessage.success('个人资料已保存');
}

const userAvatar = computed(() => displayAvatar(defaultAvatarImg));
const userNickname = computed(() => displayNickname());

// —— 账号同步状态（与顶栏账号菜单共用 store）——
const SYNC_LABEL: Record<SyncStatus, string> = {
  idle: '等待同步',
  saving: '同步中',
  synced: '已同步',
  error: '同步失败',
  conflict: '数据冲突',
};
const SYNC_ICON: Record<SyncStatus, string> = {
  idle: 'lucide:clock',
  saving: 'lucide:rotate-ccw',
  synced: 'lucide:check-circle',
  error: 'lucide:triangle-alert',
  conflict: 'lucide:triangle-alert',
};
const syncLabel = computed(() => SYNC_LABEL[syncStatus.value]);
const syncIcon = computed(() => SYNC_ICON[syncStatus.value]);
const syncHint = computed(() => {
  if (syncStatus.value === 'error') {
    return syncError.value || '云端暂时不可用';
  }
  if (syncStatus.value === 'conflict') return '云端已更新，请选择保留版本';
  return '';
});
const retrying = ref(false);

async function handleRetrySync() {
  if (retrying.value) return;
  retrying.value = true;
  try {
    await retrySync();
  } catch {
    // 失败原因由 store 的 syncStatus / error 展示。
  } finally {
    retrying.value = false;
  }
}

// ── 数据导出 / 导入 ──
const importInput = ref<HTMLInputElement | null>(null);

function handleExport() {
  const blob = new Blob([exportBackup()], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `栖心自习室-${todayKey()}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function triggerImport() {
  importInput.value?.click();
}

async function handleImport(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    // importBackup 内部会 await 云端保存；只有同步完成才刷新页面。
    await importBackup(await file.text());
    ElMessage.success('数据已导入并同步，正在刷新页面');
    window.location.reload();
  } catch (caught) {
    ElMessage.error(
      caught instanceof Error ? caught.message : '导入失败：文件格式不正确',
    );
  } finally {
    input.value = '';
  }
}

/** 两个 YYYY-MM-DD 之间相隔的天数（含首日，首日算作第 1 天）。 */
function inclusiveDayDiff(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / 86_400_000)) + 1;
}

const checkins = computed<StudyRoomCheckin[]>(() => {
  const list = state.value.checkins ?? [];
  return Array.isArray(list) ? list : [];
});

// ── 专注数据（来自 focus_sessions，每完成一个番茄写入一条）──
const focusSessions = computed<StudyRoomFocusSession[]>(() => {
  const list = state.value.focus_sessions ?? [];
  return Array.isArray(list) ? list : [];
});
const focusMinutesTotal = computed(() =>
  focusSessions.value.reduce((sum, s) => sum + (Number(s.minutes) || 0), 0),
);
const pomodoroCount = computed(() => focusSessions.value.length);

/** ISO 时间字符串 → 本地日期 key（YYYY-MM-DD），用于按天归并专注时长。 */
function localDateKeyOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return dateKeyOf(d);
}

/** 每天完整结束的专注分钟数。 */
const focusMinutesByDay = computed(() => {
  const map = new Map<string, number>();
  for (const s of focusSessions.value) {
    const key = localDateKeyOf(s.createdAt);
    if (!key) continue;
    map.set(key, (map.get(key) ?? 0) + (Number(s.minutes) || 0));
  }
  return map;
});

const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];

interface FocusDayBar {
  key: string;
  weekday: string;
  isToday: boolean;
  minutes: number;
}

/**
 * 最近 7 天（含今天）每天的专注分钟数。
 * 注意：必须基于 focus_sessions 真实记录，不能用打卡次数近似 ——
 * 否则会出现"今天 0 分钟"但柱状图仍有高度这种自相矛盾的显示。
 */
const last7DaysFocusBars = computed<FocusDayBar[]>(() => {
  const bars: FocusDayBar[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = dateKeyOf(d);
    bars.push({
      key,
      weekday: WEEKDAY_CN[d.getDay()]!,
      isToday: i === 0,
      minutes: focusMinutesByDay.value.get(key) ?? 0,
    });
  }
  return bars;
});

/** 柱状图刻度基准：至少按 25 分钟算，这样一个番茄就能占满一柱。 */
const maxFocusDayMinutes = computed(() =>
  Math.max(25, ...last7DaysFocusBars.value.map((d) => d.minutes)),
);

function focusBarHeight(minutes: number): string {
  if (minutes <= 0) return '3px';
  const pct = Math.min(100, Math.max(6, Math.round((minutes / maxFocusDayMinutes.value) * 100)));
  return `${pct}%`;
}

const todayFocusMinutes = computed(() => focusMinutesByDay.value.get(todayKey()) ?? 0);

/** 本周（周一起算）专注分钟数。 */
const focusWeekMinutes = computed(() => {
  const now = new Date();
  const offset = (now.getDay() + 6) % 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
  const startKey = dateKeyOf(monday);
  let sum = 0;
  for (const [key, minutes] of focusMinutesByDay.value) {
    if (key >= startKey) sum += minutes;
  }
  return sum;
});

// —— 顶部指标 ——
const joinDays = computed(() => {
  const list = checkins.value;
  if (list.length === 0) return 0;
  const firstDate = list[0]?.date ?? todayKey();
  const earliest = list.reduce(
    (min, c) => (typeof c.date === 'string' && c.date < min ? c.date : min),
    firstDate,
  );
  return inclusiveDayDiff(earliest, todayKey());
});

const activeDates = computed(() => new Set(checkins.value.map((c) => c.date)));

const streak = computed(() =>
  checkins.value.length === 0 ? 0 : calcStreak(activeDates.value),
);

const totalCheckins = computed(() => checkins.value.length);

// —— 学习完成度 ——
const checkinDays = computed(() => activeDates.value.size);
const yearProgress = computed(() =>
  Math.round(Math.min(100, (checkinDays.value / YEAR_GOAL) * 100)),
);

// —— 专注时长 ——
/** 紧凑时长显示：小于 1 小时显示分钟，否则显示小时。 */
function formatCompact(minutes: number): string {
  if (minutes < 60) return `${minutes}分钟`;
  const hours = minutes / 60;
  return hours < 10 ? `${Number(hours.toFixed(1))}小时` : `${Math.round(hours)}小时`;
}

const focusTotalMinutes = focusMinutesTotal;

const hasAnyData = computed(
  () => checkins.value.length > 0 || pomodoroCount.value > 0,
);
</script>

<template>
  <div class="study-room-extension study-home">
    <div class="sr-ext-header">
      <div class="study-home-title">
        <p class="eyebrow">Profile</p>
        <h1>主页</h1>
        <p class="subtitle">回看你的坚持与专注轨迹</p>
      </div>
    </div>

    <!-- 个人资料卡（对齐原项目顶部大卡） -->
    <section class="sr-panel study-home-profile">
      <div class="profile-main">
        <img
          :src="userAvatar"
          alt="头像"
          class="profile-avatar"
          referrerpolicy="no-referrer"
        />
        <div class="profile-info">
          <p class="profile-eyebrow">Personal space</p>
          <h2>{{ userNickname }}</h2>
          <p class="profile-email">
            {{ STATIC_MODE ? '本地账号' : '已登录 · 数据自动同步' }}
          </p>
          <p v-if="!STATIC_MODE" class="profile-sync" :class="`is-${syncStatus}`">
            <IconifyIcon
              :icon="syncIcon"
              :class="{ 'is-spinning': syncStatus === 'saving' }"
            />
            <span>{{ syncLabel }}</span>
            <span v-if="syncHint" class="profile-sync-hint">{{ syncHint }}</span>
            <button
              v-if="syncStatus === 'error'"
              type="button"
              class="profile-sync-retry"
              :disabled="retrying"
              @click="handleRetrySync"
            >
              {{ retrying ? '同步中' : '立即同步' }}
            </button>
          </p>
          <p class="profile-bio">这个人很懒，什么都没有写</p>
          <p class="profile-joined">
            <IconifyIcon icon="lucide:calendar" />
            于 {{ joinDays > 0 ? `${joinDays} 天前` : '今天' }} 加入
          </p>
        </div>
      </div>
      <div class="profile-actions">
        <button type="button" class="profile-action" @click="openProfileEditor">
          <IconifyIcon icon="lucide:pencil" />
          编辑资料
        </button>
        <button type="button" class="profile-action" @click="handleExport">
          导出数据
        </button>
        <button type="button" class="profile-action" @click="triggerImport">
          导入数据
        </button>
        <input
          ref="importInput"
          type="file"
          accept="application/json,.json"
          hidden
          @change="handleImport"
        />
      </div>
    </section>

    <!-- 始终显示完整布局（0 值也显示），对齐原项目统计主页 -->
    <!-- 指标行 -->
    <div class="study-home-metrics">
      <div class="sr-metric">
        <span class="sr-metric-icon"><IconifyIcon icon="lucide:calendar-check" /></span>
        <div>
          <div class="sr-metric-label">加入天数</div>
          <div class="sr-metric-value">
            {{ joinDays }}<span class="sr-metric-unit">天</span>
          </div>
        </div>
      </div>

      <div class="sr-metric">
        <span class="sr-metric-icon"><IconifyIcon icon="lucide:flame" /></span>
        <div>
          <div class="sr-metric-label">连续活跃</div>
          <div class="sr-metric-value">
            {{ streak }}<span class="sr-metric-unit">天</span>
          </div>
        </div>
      </div>

      <div class="sr-metric">
        <span class="sr-metric-icon"><IconifyIcon icon="lucide:chart-line-up" /></span>
        <div>
          <div class="sr-metric-label">打卡总数</div>
          <div class="sr-metric-value">
            {{ totalCheckins }}<span class="sr-metric-unit">次</span>
          </div>
        </div>
      </div>
    </div>

    <div class="study-home-grid">
      <!-- 学习完成度 -->
      <section class="sr-panel study-home-completion">
        <div class="study-home-panel-head">
          <div>
            <h2>学习完成度</h2>
            <p class="study-home-panel-sub">年度打卡进度</p>
          </div>
          <span class="study-home-big-num">
            {{ yearProgress }}<span class="study-home-unit">%</span>
          </span>
        </div>
        <div class="study-home-progress-track">
          <div
            class="study-home-progress-fill"
            :style="{ width: `${yearProgress}%` }"
          />
        </div>
        <div class="study-home-completion-meta">
          <span>{{ checkinDays }} 天已打卡</span>
          <span>{{ YEAR_GOAL }} 天年度目标</span>
        </div>
      </section>
    </div>

    <!-- 番茄钟时间轨迹：左侧标题 + 中间 7 天柱状图 + 右侧三项统计（对齐参考图） -->
    <section class="sr-panel study-home-focus-board">
      <div class="focus-board-title">
        <span class="focus-board-icon"><IconifyIcon icon="lucide:clock" /></span>
        <div>
          <p class="focus-board-eyebrow">累计专注</p>
          <h2>番茄钟时间轨迹</h2>
          <p class="focus-board-sub">完整结束后自动累计</p>
        </div>
      </div>

      <div class="focus-board-chart">
        <div class="focus-board-chart-head">
          <span class="focus-board-range">最近 7 天</span>
          <span class="focus-board-today">今天 {{ todayFocusMinutes }} 分钟</span>
        </div>
        <div class="focus-board-bars">
          <div
            v-for="day in last7DaysFocusBars"
            :key="day.key"
            class="focus-board-bar-col"
            :class="{ today: day.isToday }"
            :title="`${day.key}：${day.minutes} 分钟`"
          >
            <div class="focus-board-bar-track">
              <div
                class="focus-board-bar-fill"
                :style="{ height: focusBarHeight(day.minutes) }"
              />
            </div>
            <span class="focus-board-bar-label">{{ day.weekday }}</span>
          </div>
        </div>
        <div class="focus-board-axis">自适应刻度</div>
      </div>

      <div class="focus-board-stats">
        <div class="focus-board-stat">
          <span class="focus-board-stat-icon"><IconifyIcon icon="lucide:trending-up" /></span>
          <strong>{{ formatCompact(focusTotalMinutes) }}</strong>
          <span class="focus-board-stat-label">累计</span>
        </div>
        <div class="focus-board-stat">
          <span class="focus-board-stat-icon"><IconifyIcon icon="lucide:flame" /></span>
          <strong>{{ formatCompact(focusWeekMinutes) }}</strong>
          <span class="focus-board-stat-label">本周</span>
        </div>
        <div class="focus-board-stat">
          <span class="focus-board-stat-icon"><IconifyIcon icon="lucide:timer-reset" /></span>
          <strong>{{ pomodoroCount }} 次</strong>
          <span class="focus-board-stat-label">番茄</span>
        </div>
      </div>
    </section>

    <p v-if="!hasAnyData" class="study-home-hint-empty">
      完成第一次打卡或专注后，这里会亮起你的轨迹。
    </p>

    <!-- 编辑资料弹窗：与自习室暗色主题统一，不再跳转到个人中心 -->
    <ElDialog
      v-model="profileEditVisible"
      title="编辑资料"
      width="min(440px, 92vw)"
      class="study-home-profile-dialog"
      append-to-body
    >
      <div class="profile-editor">
        <label class="avatar-uploader">
          <input type="file" accept="image/*" hidden @change="onAvatarChange" />
          <img
            :src="profileForm.avatar || account?.picture || defaultAvatar"
            class="editable-avatar"
            alt="用户头像"
            referrerpolicy="no-referrer"
          />
        </label>
        <span class="avatar-hint">点击头像更换图片</span>
        <ElInput v-model="profileForm.nickname" placeholder="请输入昵称" />
      </div>
      <template #footer>
        <ElButton @click="profileEditVisible = false">取消</ElButton>
        <ElButton type="primary" @click="saveProfile">保存</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped>
.study-home {
  display: flex;
  width: 100%;
  max-width: 1180px;
  flex-direction: column;
  gap: 14px;
  margin: 0 auto;
}

.study-home-empty-icon {
  display: flex;
  width: 44px;
  height: 44px;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--study-room-primary) 10%, transparent);
  border-radius: 50%;
  color: color-mix(in srgb, var(--study-room-primary) 55%, transparent);
}

.study-home-hint-empty {
  margin: 0;
  color: rgb(255 255 255 / 0.4);
  font-size: 13px;
  text-align: center;
}

/* 个人资料卡 */
.study-home-profile {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 22px 24px;
}

.profile-main {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: 18px;
}

.profile-avatar {
  width: 72px;
  height: 72px;
  flex-shrink: 0;
  border-radius: 50%;
  object-fit: cover;
  box-shadow: 0 8px 22px rgb(0 0 0 / 0.3);
}

.profile-info {
  min-width: 0;
}

.profile-eyebrow {
  margin: 0 0 4px;
  color: rgb(255 255 255 / 0.45);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.profile-info h2 {
  margin: 0;
  overflow-wrap: anywhere;
  color: #fff;
  font-size: 24px;
  font-weight: 800;
}

.profile-email {
  margin: 4px 0 0;
  color: rgb(255 255 255 / 0.5);
  font-size: 13px;
}

.profile-sync {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin: 6px 0 0;
  color: rgb(255 255 255 / 0.5);
  font-size: 12px;
}

.profile-sync.is-synced {
  color: color-mix(in srgb, var(--study-room-primary) 82%, white);
}

.profile-sync.is-error,
.profile-sync.is-conflict {
  color: #ffb45f;
}

.profile-sync-hint {
  min-width: 0;
  overflow-wrap: anywhere;
  color: rgb(255 255 255 / 0.45);
}

.profile-sync-retry {
  padding: 2px 9px;
  border: 1px solid color-mix(in srgb, var(--study-room-primary) 45%, transparent);
  border-radius: 999px;
  color: var(--study-room-primary);
  background: transparent;
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
}

.profile-sync-retry:hover:not(:disabled) {
  background: color-mix(in srgb, var(--study-room-primary) 14%, transparent);
}

.profile-sync-retry:disabled {
  cursor: default;
  opacity: 0.6;
}

.is-spinning {
  animation: study-home-spin 0.9s linear infinite;
}

@keyframes study-home-spin {
  to {
    transform: rotate(360deg);
  }
}

.profile-bio {
  margin: 10px 0 0;
  color: rgb(255 255 255 / 0.62);
  font-size: 13px;
}

.profile-joined {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 10px 0 0;
  color: rgb(255 255 255 / 0.4);
  font-size: 12px;
}

.profile-actions {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  gap: 10px;
}

/* 可点击的资料操作按钮（原来是纯 span，点了没有任何反应） */
.profile-action {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 14px;
  border: 1px solid rgb(255 255 255 / 0.14);
  border-radius: 999px;
  color: rgb(255 255 255 / 0.72);
  background: rgb(255 255 255 / 0.05);
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
  transition: all 0.18s ease;
}

.profile-action:hover {
  border-color: color-mix(in srgb, var(--study-room-primary) 55%, transparent);
  color: var(--study-room-primary);
  background: rgb(255 255 255 / 0.1);
}

.profile-action:active {
  transform: scale(0.98);
}

/* 编辑资料弹窗（挂到 body，故用 :global 命中） */
.profile-editor {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 8px 0;
}

.avatar-uploader {
  display: block;
  overflow: hidden;
  width: 76px;
  height: 76px;
  border: 1px solid rgb(255 255 255 / 0.18);
  border-radius: 50%;
  cursor: pointer;
}

.editable-avatar {
  width: 76px;
  height: 76px;
  object-fit: cover;
}

.avatar-hint {
  color: rgb(255 255 255 / 0.45);
  font-size: 12px;
}

/* 顶部指标行 */
.study-home-metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}

.study-home-grid {
  display: grid;
  /* 专注时长已合并进下方「番茄钟时间轨迹」面板，这里只剩学习完成度一张卡，故单列铺满 */
  grid-template-columns: minmax(0, 1fr);
  gap: 14px;
}

/* 面板通用头部 */
.study-home-panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.study-home-panel-head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: #fff;
}

.study-home-panel-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: rgb(255 255 255 / 0.4);
}

.study-home-big-num {
  color: #fff;
  font-size: 26px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.study-home-big-num .study-home-unit {
  margin-left: 2px;
  font-size: 14px;
  font-weight: 400;
  color: rgb(255 255 255 / 0.4);
}

.study-home-completion,
.study-home-focus,
.study-home-chart {
  padding: 18px 20px;
}

/* 学习完成度进度条 */
.study-home-progress-track {
  height: 10px;
  overflow: hidden;
  border-radius: 999px;
  background: rgb(255 255 255 / 0.1);
}

.study-home-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--study-room-primary);
  box-shadow: 0 0 14px color-mix(in srgb, var(--study-room-primary) 45%, transparent);
  transition: width 0.4s ease;
}

.study-home-completion-meta {
  display: flex;
  justify-content: space-between;
  margin-top: 10px;
  font-size: 12px;
  color: rgb(255 255 255 / 0.5);
  font-variant-numeric: tabular-nums;
}

/* ─────────────────────────────────────────────────────────────
 * 番茄钟时间轨迹：横向三段布局（标题 / 柱状图 / 统计），对齐参考图。
 * ───────────────────────────────────────────────────────────── */
.study-home-focus-board {
  display: grid;
  grid-template-columns: minmax(150px, 0.9fr) minmax(280px, 1.6fr) minmax(240px, 1.1fr);
  gap: 20px;
  align-items: center;
  padding: 18px 22px;
}

/* 左侧标题 */
.focus-board-title {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.focus-board-icon {
  display: flex;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  color: rgb(255 255 255 / 0.55);
  font-size: 16px;
}

.focus-board-eyebrow {
  margin: 0 0 4px;
  color: rgb(255 255 255 / 0.45);
  font-size: 11px;
  letter-spacing: 0.04em;
}

.focus-board-title h2 {
  margin: 0;
  color: #fff;
  font-size: 17px;
  font-weight: 800;
  line-height: 1.3;
}

.focus-board-sub {
  margin: 5px 0 0;
  color: rgb(255 255 255 / 0.4);
  font-size: 12px;
}

/* 中间柱状图 */
.focus-board-chart {
  min-width: 0;
}

.focus-board-chart-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
  color: rgb(255 255 255 / 0.42);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.focus-board-today {
  color: rgb(255 255 255 / 0.55);
}

.focus-board-bars {
  display: flex;
  height: 74px;
  align-items: flex-end;
  gap: 8px;
}

.focus-board-bar-col {
  display: flex;
  flex: 1;
  height: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.focus-board-bar-track {
  display: flex;
  width: 100%;
  flex: 1;
  align-items: flex-end;
  overflow: hidden;
  border-radius: 3px;
  /* 轨道底色：让"没专注的那天"也能看到空槽位，而不是完全消失 */
  background: rgb(255 255 255 / 0.05);
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.04);
}

.focus-board-bar-fill {
  width: 100%;
  border-radius: 3px;
  /* 历史日期用中性灰，和参考图一致，避免整排都是亮绿色 */
  background: rgb(255 255 255 / 0.22);
  transition: height 0.3s ease;
}

.focus-board-bar-col.today .focus-board-bar-fill {
  background: var(--study-room-primary);
  box-shadow: 0 0 14px color-mix(in srgb, var(--study-room-primary) 45%, transparent);
}

.focus-board-bar-label {
  color: rgb(255 255 255 / 0.4);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

/* 今天：标签下方加一道白色短线做定位（参考图里「日」下方的白线） */
.focus-board-bar-col.today .focus-board-bar-label {
  color: var(--study-room-primary);
  font-weight: 700;
  box-shadow: 0 2px 0 0 rgb(255 255 255 / 0.85);
}

.focus-board-axis {
  margin-top: 8px;
  border-top: 1px solid rgb(255 255 255 / 0.1);
  padding-top: 6px;
  color: rgb(255 255 255 / 0.3);
  font-size: 10px;
  text-align: right;
}

/* 右侧三项统计 */
.focus-board-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.focus-board-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 4px;
  border-left: 1px solid rgb(255 255 255 / 0.08);
  text-align: center;
}

.focus-board-stat:first-child {
  border-left: 0;
}

.focus-board-stat-icon {
  color: rgb(255 255 255 / 0.4);
  font-size: 15px;
}

.focus-board-stat strong {
  color: #fff;
  font-size: 17px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.focus-board-stat-label {
  color: rgb(255 255 255 / 0.38);
  font-size: 11px;
}

@media (max-width: 1100px) {
  .study-home-focus-board {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .focus-board-stat {
    border-left: 0;
    border-top: 1px solid rgb(255 255 255 / 0.08);
    padding-top: 10px;
  }
}

@media (max-width: 720px) {
  .study-home-metrics,
  .study-home-grid,
  .study-home-focus-metrics {
    grid-template-columns: 1fr;
  }
}
</style>
