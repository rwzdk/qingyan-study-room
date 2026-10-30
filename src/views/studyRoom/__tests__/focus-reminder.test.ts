import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_FOCUS_REMINDER,
  loadReminderPrefs,
  normalizeReminderPrefs,
  REMINDER_STORAGE_KEY,
  saveReminderPrefs,
} from '../focus-reminder-prefs';

class FakeParam {
  value = 0;
  setValueAtTime() {}
  exponentialRampToValueAtTime() {}
  setTargetAtTime() {}
}

class FakeNode {
  onended: (() => void) | null = null;
  connect() {
    return this;
  }
  disconnect() {}
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeOscillator extends FakeNode {
  type = 'sine';
  frequency = new FakeParam();
  started = 0;
  stopped = 0;
  start(when?: number) {
    this.started = when ?? 0;
  }
  stop(when?: number) {
    this.stopped = when ?? 0;
  }
}

class FakeBufferSource extends FakeNode {
  buffer: unknown = null;
  started = 0;
  stopped = 0;
  start(when?: number) {
    this.started = when ?? 0;
  }
  stop(when?: number) {
    this.stopped = when ?? 0;
  }
}

class FakeAudioContext {
  currentTime = 0;
  state = 'running';
  sampleRate = 48_000;
  destination = new FakeNode();
  bufferSources: FakeBufferSource[] = [];
  oscillators: FakeOscillator[] = [];

  constructor() {
    lastContext = this;
  }

  createGain() {
    return new FakeGain();
  }
  createOscillator() {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }
  createBufferSource() {
    const source = new FakeBufferSource();
    this.bufferSources.push(source);
    return source;
  }
  createBuffer(_channels: number, length: number) {
    return { length };
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
}

let lastContext: FakeAudioContext | null = null;

describe('focus-reminder-prefs', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('脏数据时回落到默认配置', () => {
    expect(normalizeReminderPrefs(null)).toEqual(DEFAULT_FOCUS_REMINDER);
    expect(normalizeReminderPrefs('乱码')).toEqual(DEFAULT_FOCUS_REMINDER);
    expect(normalizeReminderPrefs({ sound: '爆炸' }).sound).toBe('bell');
  });

  it('清洗越界数值与超长文字', () => {
    const prefs = normalizeReminderPrefs({
      rate: 9,
      pitch: -3,
      volume: 5,
      text: `  ${'话'.repeat(200)}  `,
    });
    expect(prefs.rate).toBe(2);
    expect(prefs.pitch).toBe(0);
    expect(prefs.volume).toBe(1);
    expect(prefs.text.length).toBe(120);
  });

  it('空白提示词回落到默认文案', () => {
    expect(normalizeReminderPrefs({ text: '   ' }).text).toBe(
      DEFAULT_FOCUS_REMINDER.text,
    );
  });

  it('保存后能读回同一份配置', () => {
    saveReminderPrefs({
      ...DEFAULT_FOCUS_REMINDER,
      text: '喝口水',
      sound: 'chime',
      rate: 1.2,
    });
    const loaded = loadReminderPrefs();
    expect(loaded.text).toBe('喝口水');
    expect(loaded.sound).toBe('chime');
    expect(loaded.rate).toBe(1.2);
    expect(window.localStorage.getItem(REMINDER_STORAGE_KEY)).toBeTruthy();
  });
});

describe('focus-reminder-engine', () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    vi.stubGlobal('AudioContext', FakeAudioContext);
  });

  it('把提示音与到点回调排到音频时间轴上', async () => {
    const engine = await import('../focus-reminder-engine');
    const onDue = vi.fn();
    const onSpeak = vi.fn();
    const at = Date.now() + 30_000;

    engine.armReminder(at, 'bell', { onDue, onSpeak });

    expect(engine.hasArmedReminder()).toBe(true);
    // 三个钟声各两枚振荡器（基频 + 泛音），外加一枚听不见的保活振荡器。
    expect(lastContext?.oscillators.length).toBe(7);
    // 两个静音标记：到点、该播报语音。
    expect(lastContext?.bufferSources.length).toBe(2);

    const [dueMarker, speakMarker] = lastContext!.bufferSources;
    expect(onDue).not.toHaveBeenCalled();
    expect(onSpeak).not.toHaveBeenCalled();

    dueMarker.onended?.();
    expect(onDue).toHaveBeenCalledTimes(1);
    expect(onSpeak).not.toHaveBeenCalled();

    speakMarker.onended?.();
    expect(onSpeak).toHaveBeenCalledTimes(1);
  });

  it('不响铃时只排到点回调', async () => {
    const engine = await import('../focus-reminder-engine');
    engine.armReminder(Date.now() + 30_000, 'none', {
      onDue: vi.fn(),
      onSpeak: vi.fn(),
    });
    expect(engine.hasArmedReminder()).toBe(true);
    // 即使不响铃也保留保活振荡器，避免后台标签页被冻结。
    expect(lastContext?.oscillators.length).toBe(1);
    expect(lastContext?.bufferSources.length).toBe(2);
  });

  it('取消提醒不会误触发到点回调', async () => {
    const engine = await import('../focus-reminder-engine');
    const onDue = vi.fn();
    const onSpeak = vi.fn();
    engine.armReminder(Date.now() + 30_000, 'bell', { onDue, onSpeak });
    const markers = [...lastContext!.bufferSources];

    engine.cancelReminder();
    // stop() 会派发 ended，挂着的回调必须已经被摘掉，否则这一轮会被提前结算。
    for (const marker of markers) marker.onended?.();
    expect(onDue).not.toHaveBeenCalled();
    expect(onSpeak).not.toHaveBeenCalled();
    expect(engine.hasArmedReminder()).toBe(false);
  });

  it('取消后不再保留已排程的提示音', async () => {
    const engine = await import('../focus-reminder-engine');
    engine.armReminder(Date.now() + 30_000, 'bell', {
      onDue: vi.fn(),
      onSpeak: vi.fn(),
    });
    expect(engine.hasArmedReminder()).toBe(true);
    engine.cancelReminder();
    expect(engine.hasArmedReminder()).toBe(false);
  });

  it('同一轮只允许一个标签页播报', async () => {
    const engine = await import('../focus-reminder-engine');
    expect(engine.claimReminderFire('focus-1:focus')).toBe(true);
    expect(engine.claimReminderFire('focus-1:focus')).toBe(false);
    expect(engine.claimReminderFire('focus-2:focus')).toBe(true);
  });

  it('没有语音合成能力时返回失败', async () => {
    const engine = await import('../focus-reminder-engine');
    expect(
      engine.speakReminder('休息一下吧', DEFAULT_FOCUS_REMINDER),
    ).toBe(false);
  });

  it('按当前音色与语速播报自定义文字', async () => {
    const speak = vi.fn();
    vi.stubGlobal('speechSynthesis', {
      getVoices: () => [
        { voiceURI: 'zh-CN-1', name: '中文', lang: 'zh-CN', default: false },
      ],
      speak,
      cancel: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        text: string;
        voice: unknown = null;
        lang = '';
        rate = 1;
        pitch = 1;
        volume = 1;
        onerror: (() => void) | null = null;
        constructor(text: string) {
          this.text = text;
        }
      },
    );
    const engine = await import('../focus-reminder-engine');
    const ok = engine.speakReminder('喝口水', {
      ...DEFAULT_FOCUS_REMINDER,
      voiceURI: 'zh-CN-1',
      rate: 1.4,
    });
    expect(ok).toBe(true);
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak.mock.calls[0][0].text).toBe('喝口水');
    expect(speak.mock.calls[0][0].rate).toBe(1.4);
    expect(speak.mock.calls[0][0].voice.voiceURI).toBe('zh-CN-1');
  });
});
