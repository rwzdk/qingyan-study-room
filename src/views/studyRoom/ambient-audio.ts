/**
 * 环境音合成器（Web Audio API）。
 *
 * 为什么不用现成音频文件：
 *  - 原 rain 音频 27MB / 899s，首个字节就要等很久；而且实测样本突变 102 处、
 *    立体声相关度仅 0.32（伪立体声），听起来'糊'且不真实。
 *  - 原 snow 音频是 40s 循环，接缝处会有可闻的咔哒。
 * 合成方案无文件加载、无缝循环、可按场景调参。
 *
 * 雨声的做法（经典且自然的组合）：
 *  1. 白噪声 → 低频搁架衰减 → 得到'雨幕'底噪
 *  2. 带通滤波 + 慢速 LFO 调制增益 → '雨滴打在树叶/窗户'的沙沙起伏
 *  3. 少量随机高频短促脉冲 → 近处雨滴细节
 *  4. 极轻的粉红噪声低频层 → 房间/远处的空气感
 * 雪声则是几乎全频带的低通噪声 + 极缓慢起伏，安静、绵密。
 */

export type AmbientPreset = 'rain' | 'snow' | 'cloud';

interface LayerHandle {
  stop: () => void;
}

/** 生成指定长度的白噪声缓冲（循环播放用，本身即无接缝）。 */
function createNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

/**
 * 生成"粉红化"噪声缓冲：用简单的 Voss-McCartney 近似，
 * 比纯白噪声更接近雨声/风声的自然频谱（低频更厚、高频更柔）。
 */
function createPinkNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
  return buffer;
}

/** 带 LFO 的增益调制，让噪声有"呼吸"的起伏，避免像空调底噪。 */
function makeLfoGain(
  ctx: AudioContext,
  target: AudioParam,
  base: number,
  depth: number,
  rate: number,
  phase = 0,
): OscillatorNode {
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = rate;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = depth;
  target.value = base;
  lfo.connect(lfoGain);
  lfoGain.connect(target);
  // 相位错开：用 detune 无法直接控相位，改用 start 延时近似
  if (phase > 0) {
    lfo.start(ctx.currentTime + phase);
  } else {
    lfo.start();
  }
  return lfo;
}

function buildRain(ctx: AudioContext, out: GainNode): LayerHandle {
  const stops: Array<() => void> = [];

  // — 雨幕底噪：白噪声经低通，裁掉刺耳高频，并切掉过闷的低频 —
  const bedSrc = ctx.createBufferSource();
  bedSrc.buffer = createNoiseBuffer(ctx, 4);
  bedSrc.loop = true;
  const bedHighpass = ctx.createBiquadFilter();
  bedHighpass.type = 'highpass';
  bedHighpass.frequency.value = 180;
  const bedFilter = ctx.createBiquadFilter();
  bedFilter.type = 'lowpass';
  bedFilter.frequency.value = 5200;
  bedFilter.Q.value = 0.6;
  const bedShelf = ctx.createBiquadFilter();
  bedShelf.type = 'highshelf';
  bedShelf.frequency.value = 2600;
  bedShelf.gain.value = -7;
  const bedGain = ctx.createGain();
  bedGain.gain.value = 0.3;
  bedSrc.connect(bedHighpass);
  bedHighpass.connect(bedFilter);
  bedFilter.connect(bedShelf);
  bedShelf.connect(bedGain);
  bedGain.connect(out);
  bedSrc.start();
  stops.push(() => bedSrc.stop());

  // — 雨的"沙沙"起伏：带通噪声 + 慢速 LFO，模拟雨势变化 —
  const rustleSrc = ctx.createBufferSource();
  rustleSrc.buffer = createNoiseBuffer(ctx, 5);
  rustleSrc.loop = true;
  const rustleBand = ctx.createBiquadFilter();
  rustleBand.type = 'bandpass';
  rustleBand.frequency.value = 1600;
  rustleBand.Q.value = 0.85;
  const rustleGain = ctx.createGain();
  rustleGain.gain.value = 0.2;
  rustleSrc.connect(rustleBand);
  rustleBand.connect(rustleGain);
  rustleGain.connect(out);
  rustleSrc.start();
  stops.push(() => rustleSrc.stop());

  // 两个不同速率的 LFO 叠加，起伏不会呈周期性
  const lfo1 = makeLfoGain(ctx, rustleGain.gain, 0.2, 0.1, 0.11);
  const lfo2 = makeLfoGain(ctx, rustleGain.gain, 0.2, 0.06, 0.043, 0.7);
  stops.push(() => lfo1.stop());
  stops.push(() => lfo2.stop());

  // 带通中心频率也做缓慢扫动，让"沙沙"的音色有变化
  const centerLfo = ctx.createOscillator();
  centerLfo.type = 'sine';
  centerLfo.frequency.value = 0.067;
  const centerGain = ctx.createGain();
  centerGain.gain.value = 380;
  centerLfo.connect(centerGain);
  centerGain.connect(rustleBand.frequency);
  centerLfo.start();
  stops.push(() => centerLfo.stop());

  // — 近处雨滴：随机短促高频脉冲 —
  const dropBuf = createNoiseBuffer(ctx, 0.08);
  let dropTimer = 0;
  const scheduleDrops = () => {
    const now = ctx.currentTime;
    const count = 3;
    for (let i = 0; i < count; i += 1) {
      const src = ctx.createBufferSource();
      src.buffer = dropBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2600 + Math.random() * 3400;
      bp.Q.value = 6 + Math.random() * 8;
      const g = ctx.createGain();
      const t = now + Math.random() * 0.45;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.035 + Math.random() * 0.05, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07 + Math.random() * 0.1);
      src.connect(bp);
      bp.connect(g);
      g.connect(out);
      src.start(t);
      src.stop(t + 0.25);
    }
    dropTimer = window.setTimeout(scheduleDrops, 320 + Math.random() * 380);
  };
  scheduleDrops();
  stops.push(() => window.clearTimeout(dropTimer));

  // — 极轻的低频空气感（音量压得很低，避免 80Hz 频段发闷） —
  const pinkSrc = ctx.createBufferSource();
  pinkSrc.buffer = createPinkNoiseBuffer(ctx, 6);
  pinkSrc.loop = true;
  const pinkHighpass = ctx.createBiquadFilter();
  pinkHighpass.type = 'highpass';
  pinkHighpass.frequency.value = 150;
  const pinkFilter = ctx.createBiquadFilter();
  pinkFilter.type = 'lowpass';
  pinkFilter.frequency.value = 300;
  const pinkGain = ctx.createGain();
  pinkGain.gain.value = 0.06;
  pinkSrc.connect(pinkHighpass);
  pinkHighpass.connect(pinkFilter);
  pinkFilter.connect(pinkGain);
  pinkGain.connect(out);
  pinkSrc.start();
  stops.push(() => pinkSrc.stop());

  return { stop: () => stops.forEach((fn) => fn()) };
}

function buildSnow(ctx: AudioContext, out: GainNode): LayerHandle {
  const stops: Array<() => void> = [];

  // 雪是"安静但清亮"的：中高频噪声 + 极缓慢起伏。
  // 低切到 220Hz 去掉闷闷的低频轰鸣，高切 3.2kHz 保留轻柔的"沙"感。
  const bedSrc = ctx.createBufferSource();
  bedSrc.buffer = createPinkNoiseBuffer(ctx, 7);
  bedSrc.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3200;
  lp.Q.value = 0.4;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 220;
  const bedGain = ctx.createGain();
  bedGain.gain.value = 0.26;
  bedSrc.connect(hp);
  hp.connect(lp);
  lp.connect(bedGain);
  bedGain.connect(out);
  bedSrc.start();
  stops.push(() => bedSrc.stop());

  const lfo1 = makeLfoGain(ctx, bedGain.gain, 0.26, 0.07, 0.055);
  const lfo2 = makeLfoGain(ctx, bedGain.gain, 0.26, 0.04, 0.021, 1.1);
  stops.push(() => lfo1.stop());
  stops.push(() => lfo2.stop());

  // 高频"落雪"纹理，让声音通透不闷
  const airSrc = ctx.createBufferSource();
  airSrc.buffer = createNoiseBuffer(ctx, 4);
  airSrc.loop = true;
  const airBp = ctx.createBiquadFilter();
  airBp.type = 'bandpass';
  airBp.frequency.value = 6200;
  airBp.Q.value = 0.7;
  const airGain = ctx.createGain();
  airGain.gain.value = 0.05;
  airSrc.connect(airBp);
  airBp.connect(airGain);
  airGain.connect(out);
  airSrc.start();
  stops.push(() => airSrc.stop());

  return { stop: () => stops.forEach((fn) => fn()) };
}

export interface AmbientEngine {
  setPreset: (preset: AmbientPreset) => void;
  setVolume: (value: number) => void;
  resume: () => Promise<void>;
  dispose: () => void;
  isRunning: () => boolean;
}
/**
 * 创建环境音引擎。cloud 为静默场景（保留接口一致性）。
 * volume 由外部滑块控制，内部用 masterGain 平滑过渡，避免突兀。
 */
export function createAmbientEngine(initialPreset: AmbientPreset, volume: number): AmbientEngine {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let layer: LayerHandle | null = null;
  let preset: AmbientPreset = initialPreset;
  let currentVolume = volume;
  let running = false;

  function ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!ctx) {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = currentVolume;
      master.connect(ctx.destination);
    }
    return ctx;
  }

  function stopLayer(): void {
    if (layer) {
      try {
        layer.stop();
      } catch {
        // 已停止时忽略
      }
      layer = null;
    }
  }

  function startLayer(nextPreset: AmbientPreset): void {
    stopLayer();
    const context = ensureContext();
    if (!context || !master) return;
    if (nextPreset === 'cloud') return;
    if (nextPreset === 'rain') {
      layer = buildRain(context, master);
    } else {
      layer = buildSnow(context, master);
    }
  }

  return {
    async setPreset(next) {
      preset = next;
      if (!running) return;
      startLayer(next);
    },
    setVolume(value) {
      currentVolume = Math.max(0, Math.min(1, value));
      if (master && ctx) {
        master.gain.setTargetAtTime(currentVolume, ctx.currentTime, 0.05);
      }
    },
    async resume() {
      const context = ensureContext();
      if (!context) return;
      if (context.state === 'suspended') {
        await context.resume();
      }
      if (!running) {
        running = true;
        startLayer(preset);
      }
    },
    dispose() {
      stopLayer();
      running = false;
      if (ctx) {
        void ctx.close();
        ctx = null;
        master = null;
      }
    },
    isRunning() {
      return running && !!ctx && ctx.state === 'running';
    },
  };
}
