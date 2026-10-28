import { readJson, writeJson } from '#/lib/storage';

export type ReminderSound = 'bell' | 'chime' | 'soft' | 'none';
export type VoiceSource = 'cloud' | 'browser';

export interface FocusReminderPrefs {
  enabled: boolean;
  useVoice: boolean;
  text: string;
  voiceSource: VoiceSource;
  cloudVoice: string;
  voiceURI: string;
  rate: number;
  pitch: number;
  volume: number;
  sound: ReminderSound;
  useNotification: boolean;
}

export const REMINDER_STORAGE_KEY = 'qingyan-study-room:focus-reminder:v1';
export const REMINDER_TEXT_MAX = 120;
export const DEFAULT_REMINDER_TEXT = '专注完成啦，起来喝口水，让眼睛看看远处吧～';
export const DEFAULT_CLOUD_VOICE = 'Momo';

export const DEFAULT_FOCUS_REMINDER: FocusReminderPrefs = {
  enabled: true,
  useVoice: true,
  text: DEFAULT_REMINDER_TEXT,
  voiceSource: 'cloud',
  cloudVoice: DEFAULT_CLOUD_VOICE,
  voiceURI: '',
  rate: 1,
  pitch: 1,
  volume: 1,
  sound: 'bell',
  useNotification: false,
};

export const REMINDER_SOUND_OPTIONS: { value: ReminderSound; label: string }[] = [
  { value: 'bell', label: '清脆钟声' },
  { value: 'chime', label: '轻快风铃' },
  { value: 'soft', label: '柔和单音' },
  { value: 'none', label: '不响铃' },
];

/** 阿里云百炼 Qwen3-TTS 音色（与 qc-student 用的是同一套服务），名字区分大小写。 */
export const CLOUD_VOICE_OPTIONS: { value: string; label: string }[] = [
  { value: 'Momo', label: '茉兔 · 撒娇搞怪女声' },
  { value: 'Cherry', label: '芊悦 · 阳光亲切女声' },
  { value: 'Serena', label: '苏瑶 · 温柔女声' },
  { value: 'Chelsie', label: '千雪 · 二次元女声' },
  { value: 'Maia', label: '四月 · 知性女声' },
  { value: 'Ethan', label: '晨煦 · 阳光男声' },
  { value: 'Moon', label: '月白 · 率性男声' },
  { value: 'Kai', label: '凯 · 沉浸感男声' },
];

const SOUNDS: ReminderSound[] = ['bell', 'chime', 'soft', 'none'];
const VOICE_SOURCES: VoiceSource[] = ['cloud', 'browser'];
const CLOUD_VOICES = CLOUD_VOICE_OPTIONS.map((option) => option.value);

/** 数值字段：缺字段或脏数据时回落到默认值，而不是压到下限（音量归零会静音播报）。 */
function numberOr(value: unknown, fallback: number, min: number, max: number) {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function toBool(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

/** 把任意来源的数据清洗成可用的偏好，避免脏数据把界面或语音播报搞崩。 */
export function normalizeReminderPrefs(raw: unknown): FocusReminderPrefs {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_FOCUS_REMINDER };
  const value = raw as Record<string, unknown>;
  const text =
    typeof value.text === 'string' ? value.text.trim().slice(0, REMINDER_TEXT_MAX) : '';
  return {
    enabled: toBool(value.enabled, DEFAULT_FOCUS_REMINDER.enabled),
    useVoice: toBool(value.useVoice, DEFAULT_FOCUS_REMINDER.useVoice),
    text: text || DEFAULT_REMINDER_TEXT,
    voiceSource: VOICE_SOURCES.includes(value.voiceSource as VoiceSource)
      ? (value.voiceSource as VoiceSource)
      : DEFAULT_FOCUS_REMINDER.voiceSource,
    cloudVoice: CLOUD_VOICES.includes(String(value.cloudVoice))
      ? String(value.cloudVoice)
      : DEFAULT_CLOUD_VOICE,
    voiceURI: typeof value.voiceURI === 'string' ? value.voiceURI : '',
    rate: numberOr(value.rate, DEFAULT_FOCUS_REMINDER.rate, 0.5, 2),
    pitch: numberOr(value.pitch, DEFAULT_FOCUS_REMINDER.pitch, 0, 2),
    volume: numberOr(value.volume, DEFAULT_FOCUS_REMINDER.volume, 0, 1),
    sound: SOUNDS.includes(value.sound as ReminderSound)
      ? (value.sound as ReminderSound)
      : DEFAULT_FOCUS_REMINDER.sound,
    useNotification: toBool(
      value.useNotification,
      DEFAULT_FOCUS_REMINDER.useNotification,
    ),
  };
}

export function loadReminderPrefs(): FocusReminderPrefs {
  return normalizeReminderPrefs(readJson<unknown>(REMINDER_STORAGE_KEY, null));
}

export function saveReminderPrefs(prefs: FocusReminderPrefs) {
  return writeJson(REMINDER_STORAGE_KEY, normalizeReminderPrefs(prefs));
}
