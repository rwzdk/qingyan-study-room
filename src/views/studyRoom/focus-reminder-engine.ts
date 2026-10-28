/**
 * 专注结束提醒引擎。
 *
 * 为什么用「音频时钟」排程，而不是靠 setTimeout：
 * 标签页被切到后台时，Chrome 会把主线程的定时器降频（隐藏 5 分钟后甚至降到
 * 每分钟一次），靠定时器触发的提醒会迟到甚至像"没响"。但音频线程独立于
 * 主线程节流，AudioContext.currentTime 始终按真实时间推进，所以把声音和
 * 回调直接排到音频时间轴上，隐藏标签页里也能准点响。
 */

import type { FocusReminderPrefs, ReminderSound } from './focus-reminder-prefs';

const FIRED_KEY = 'qingyan-study-room:focus-reminder:fired';
const FIRE_CLAIM_TTL = 120_000;

export interface ReminderHooks {
  /** 到点：切状态、发通知。 */
  onDue: () => void;
  /** 该播报语音了（排在提示音之后，避免两者叠在一起）。 */
  onSpeak: () => void;
}

let ctx: AudioContext | null = null;
let armedSources: AudioScheduledSourceNode[] = [];
let armed = false;
let storageBound = false;
/** 每次改排程都自增，旧的待执行排程（等 resume 承诺兑现）随之失效，避免重复响铃。 */
let armToken = 0;

function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
    null
  );
}

function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = getAudioContextCtor();
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  return ctx;
}

/** 首次用户手势时调用，解锁音频（自动播放策略要求）。 */
export function unlockReminderAudio() {
  const context = ensureContext();
  if (!context) return;
  if (context.state === 'suspended') {
    void context.resume().catch(() => {});
  }
}

function trackSource(source: AudioScheduledSourceNode) {
  armedSources.push(source);
}

function stopSource(source: AudioScheduledSourceNode) {
  // 先摘掉回调：stop() 会派发 ended，挂着回调会被当成"到点"，把这一轮提前结算。
  source.onended = null;
  try {
    source.stop();
  } catch {
    // 已经结束或从未启动。
  }
  try {
    source.disconnect();
  } catch {
    // 忽略。
  }
}

/** 停掉尚未播完的提示音（暂停、重置、跳过时调用）。 */
export function cancelReminder() {
  armToken += 1;
  for (const source of armedSources) stopSource(source);
  armedSources = [];
  armed = false;
}

/** 本轮是否已经排过程序。 */
export function hasArmedReminder() {
  return armed;
}

interface Strike {
  offset: number;
  freq: number;
  duration: number;
  peak: number;
}

function patternFor(sound: ReminderSound): Strike[] {
  if (sound === 'chime') {
    return [523.25, 659.25, 783.99, 1046.5].map((freq, index) => ({
      offset: index * 0.15,
      freq,
      duration: 0.55,
      peak: 0.3,
    }));
  }
  if (sound === 'soft') {
    return [{ offset: 0, freq: 660, duration: 1.2, peak: 0.24 }];
  }
  return [0, 0.42, 0.84].map((offset, index) => ({
    offset,
    freq: index === 1 ? 1318.5 : 1046.5,
    duration: 0.95,
    peak: 0.42,
  }));
}

function scheduleStrike(context: AudioContext, when: number, strike: Strike) {
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(strike.peak, when + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + strike.duration);
  gain.connect(context.destination);

  const fundamental = context.createOscillator();
  fundamental.type = 'sine';
  fundamental.frequency.value = strike.freq;
  fundamental.connect(gain);

  const partial = context.createOscillator();
  partial.type = 'sine';
  partial.frequency.value = strike.freq * 2.76;
  const partialGain = context.createGain();
  partialGain.gain.value = 0.32;
  partial.connect(partialGain);
  partialGain.connect(gain);

  fundamental.start(when);
  partial.start(when);
  fundamental.stop(when + strike.duration + 0.05);
  partial.stop(when + strike.duration + 0.05);
  return [fundamental, partial];
}

/**
 * 排一个「到点回调」：静音缓冲在目标时刻播完，onended 由音频线程投递回主线程。
 * 隐藏标签页里定时器被降频，但音频事件照常送达。
 */
function scheduleMarker(context: AudioContext, when: number, onEnd: () => void) {
  const duration = 0.02;
  const length = Math.max(1, Math.ceil(context.sampleRate * duration));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const source = context.createBufferSource();
  source.buffer = buffer;
  const gain = context.createGain();
  gain.gain.value = 0;
  source.connect(gain);
  gain.connect(context.destination);
  source.onended = () => {
    onEnd();
  };
  source.start(when - duration);
  source.stop(when);
  trackSource(source);
}

/**
 * 把提示音与回调排到未来某一刻。
 * atMs 是墙钟时间（Date.now() 口径），hooks.onDue 在该时刻触发。
 */
export function armReminder(
  atMs: number,
  sound: ReminderSound,
  hooks: ReminderHooks,
) {
  cancelReminder();
  const token = armToken;
  const context = ensureContext();
  if (!context) return;
  armed = true;

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    if (token !== armToken) return;
    const remaining = atMs - Date.now();
    // 已经过了截止时刻就立刻补响并立刻结算，别把这一轮悄悄丢掉。
    const base = context.currentTime + (remaining > 0 ? remaining / 1000 : 0.02);
    if (sound !== 'none') {
      for (const strike of patternFor(sound)) {
        for (const source of scheduleStrike(context, base + strike.offset, strike)) {
          trackSource(source);
        }
      }
    }
    const voiceOffset = sound === 'none' ? 0.1 : 1.9;
    scheduleMarker(context, base, hooks.onDue);
    scheduleMarker(context, base + voiceOffset, hooks.onSpeak);
  };

  runWhenRunning(context, schedule);
}

/** 立即响一次提示音（试听 / 兜底补响）。 */
export function playReminderNow(sound: ReminderSound) {
  if (sound === 'none') return;
  const context = ensureContext();
  if (!context) return;
  runWhenRunning(context, () => {
    const base = context.currentTime + 0.02;
    for (const strike of patternFor(sound)) {
      scheduleStrike(context, base + strike.offset, strike);
    }
  });
}

/**
 * 等音频可用再执行：没有用户手势时 resume() 的承诺可能一直不兑现，
 * 所以同时监听 statechange，音频真正跑起来的那一刻立刻执行。
 */
function runWhenRunning(context: AudioContext, run: () => void) {
  if (context.state === 'running') {
    run();
    return;
  }
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    context.removeEventListener('statechange', onStateChange);
    run();
  };
  const onStateChange = () => {
    if (context.state === 'running') once();
  };
  context.addEventListener('statechange', onStateChange);
  void context
    .resume()
    .then(once)
    .catch(() => {});
}

function getSynth(): SpeechSynthesis | null {
  if (typeof window === 'undefined') return null;
  return 'speechSynthesis' in window ? window.speechSynthesis : null;
}

const CLOUD_TTS_URL = (
  (import.meta.env.VITE_TTS_API_URL as string | undefined) ?? ''
).trim();
const voiceCache = new Map<string, AudioBuffer>();

/** 是否配置了云端语音服务（没配置就只用浏览器语音）。 */
export function cloudVoiceAvailable() {
  return CLOUD_TTS_URL.length > 0;
}

function voiceCacheKey(text: string, prefs: FocusReminderPrefs) {
  return `${prefs.cloudVoice}|${prefs.rate}|${text}`;
}

function decodeAudio(context: AudioContext, raw: ArrayBuffer) {
  return new Promise<AudioBuffer | null>((resolve) => {
    let settled = false;
    const done = (buffer?: AudioBuffer) => {
      if (settled) return;
      settled = true;
      resolve(buffer ?? null);
    };
    try {
      // 用回调式：Safari 只认这个形式。
      context.decodeAudioData(raw, done, () => done());
    } catch {
      done();
    }
  });
}

/**
 * 提前把提示文字合成好。云端合成要几百毫秒到几秒，
 * 等到点再请求会拖慢提醒，所以开始计时时就先取一次并缓存。
 */
export async function prepareCloudVoice(
  text: string,
  prefs: FocusReminderPrefs,
): Promise<boolean> {
  const content = text.trim();
  if (!CLOUD_TTS_URL || !content) return false;
  if (voiceCache.has(voiceCacheKey(content, prefs))) return true;
  const context = ensureContext();
  if (!context) return false;
  try {
    const response = await fetch(CLOUD_TTS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: content,
        voice: prefs.cloudVoice,
        speed: prefs.rate,
      }),
      // 这条链路在部分网络下会抖，给足后台预取时间，但绝不能拖到几十秒。
      signal:
        typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
          ? AbortSignal.timeout(12000)
          : undefined,
    });
    if (!response.ok) return false;
    const buffer = await decodeAudio(context, await response.arrayBuffer());
    if (!buffer) return false;
    if (voiceCache.size > 12) voiceCache.delete(voiceCache.keys().next().value as string);
    voiceCache.set(voiceCacheKey(content, prefs), buffer);
    return true;
  } catch {
    return false;
  }
}

/** 播放已缓存的云端音色；没有缓存时返回 false 交给调用方回退。 */
export function playCloudVoice(text: string, prefs: FocusReminderPrefs): boolean {
  const content = text.trim();
  if (!CLOUD_TTS_URL || !content) return false;
  const context = ensureContext();
  const buffer = voiceCache.get(voiceCacheKey(content, prefs));
  if (!context || !buffer) return false;
  const source = context.createBufferSource();
  source.buffer = buffer;
  const gain = context.createGain();
  gain.gain.value = Math.min(1, Math.max(0, prefs.volume));
  source.connect(gain);
  gain.connect(context.destination);
  source.start(context.currentTime + 0.02);
  return true;
}

/** 列出可用音色，中文音色排在前面。 */
export function listReminderVoices(): Promise<SpeechSynthesisVoice[]> {
  const synth = getSynth();
  if (!synth) return Promise.resolve([]);
  const current = synth.getVoices();
  if (current.length) return Promise.resolve(current);
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      synth.removeEventListener('voiceschanged', finish);
      resolve(synth.getVoices());
    };
    synth.addEventListener('voiceschanged', finish);
    setTimeout(finish, 1500);
  });
}

export function sortReminderVoices(voices: SpeechSynthesisVoice[]) {
  return [...voices].sort((a, b) => {
    const aZh = a.lang?.toLowerCase().startsWith('zh') ? 0 : 1;
    const bZh = b.lang?.toLowerCase().startsWith('zh') ? 0 : 1;
    if (aZh !== bZh) return aZh - bZh;
    return a.name.localeCompare(b.name);
  });
}

/** 用 TTS 播报文字。返回是否成功交给浏览器语音合成。 */
export function speakReminder(text: string, prefs: FocusReminderPrefs): boolean {
  const synth = getSynth();
  const content = text.trim();
  if (!synth || !content) return false;
  try {
    synth.cancel();
  } catch {
    // 忽略。
  }
  try {
    const utterance = new SpeechSynthesisUtterance(content);
    const voice = synth.getVoices().find((item) => item.voiceURI === prefs.voiceURI);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    utterance.rate = Math.min(2, Math.max(0.5, prefs.rate));
    utterance.pitch = Math.min(2, Math.max(0, prefs.pitch));
    utterance.volume = Math.min(1, Math.max(0, prefs.volume));
    utterance.onerror = () => {};
    synth.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    const result = await Notification.requestPermission();
    return result === 'granted';
  } catch {
    return false;
  }
}

export function showReminderNotification(title: string, body: string): boolean {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;
  try {
    const notification = new Notification(title, {
      body,
      tag: 'qingyan-focus-reminder',
      icon: '/favicon-island-32.png',
    });
    notification.onclick = () => {
      try {
        window.focus();
      } catch {
        // 忽略。
      }
      notification.close();
    };
    return true;
  } catch {
    return false;
  }
}

/**
 * 认领本轮的提醒播报权：多标签页同时开着时只让一个页面出声。
 * 成功认领的页面会把时间戳写进 localStorage，其它页面通过 storage 事件收到。
 */
export function claimReminderFire(key: string): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(FIRED_KEY);
    const previous = raw ? (JSON.parse(raw) as { key?: string; at?: number }) : null;
    const now = Date.now();
    if (
      previous &&
      previous.key === key &&
      typeof previous.at === 'number' &&
      now - previous.at < FIRE_CLAIM_TTL
    ) {
      return false;
    }
    window.localStorage.setItem(FIRED_KEY, JSON.stringify({ key, at: now }));
    return true;
  } catch {
    return true;
  }
}

function bindStorageListener() {
  if (storageBound || typeof window === 'undefined') return;
  storageBound = true;
  window.addEventListener('storage', (event) => {
    if (event.key === FIRED_KEY) cancelReminder();
  });
}

export function initReminderEngine() {
  bindStorageListener();
}
