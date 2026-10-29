/**
 * 环境音合成器（Web Audio API）。
 *
 * 为什么不用现成音频文件：
 *  - 原 rain 音频 27MB / 899s，首个字节就要等很久；而且实测样本突变 102 处、
 *    立体声相关度仅 0.32（伪立体声），听起来'糊'且不真实。
 *  - 原 snow 音频是 40s 循环，接缝处会有可闻的咔哒。
 * 合成方案无文件加载、无缝循环、可按场景调参。
 *
 * 自然感主要来自三件事：
 *  1. 立体声底噪：左右声道用两份独立噪声，声场自然铺开，不再是居中的一坨。
 *  2. 空间：每个场景共用一条干湿并行的混响总线（卷积核是生成的指数衰减噪声），
 *     雨滴、鸟鸣、浪花这类瞬态走湿声，才有"在户外"的距离感。
 *  3. 不规则事件：雨滴、虫鸣、鸟叫、浪涌都用随机间隔调度，并带随机音高与声像，
 *     避免 LFO 那种能被听出来的周期。
 */

import type { StudyRoomScene } from './study-room-scene';

export type AmbientPreset = StudyRoomScene;

interface LayerHandle {
  stop: () => void;
}

/** 白噪声缓冲。双声道各自独立随机，直接就是自然声场宽度。 */
function makeNoiseBuffer(ctx: AudioContext, seconds: number, channels = 2): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(channels, length, ctx.sampleRate);
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
  }
  return buffer;
}

/**
 * 生成"粉红化"噪声缓冲：用简单的 Voss-McCartney 近似，
 * 比纯白噪声更接近雨声/风声的自然频谱（低频更厚、高频更柔）。
 */
function makePinkBuffer(ctx: AudioContext, seconds: number, channels = 2): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(channels, length, ctx.sampleRate);
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
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
  }
  return buffer;
}

const NOISE = new WeakMap<AudioContext, AudioBuffer>();
const PINK = new WeakMap<AudioContext, AudioBuffer>();

/** 每类噪声只生成一次并复用，切场景时不用重新算 4~7 秒的缓冲。 */
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  let buffer = NOISE.get(ctx);
  if (!buffer) {
    buffer = makeNoiseBuffer(ctx, 4);
    NOISE.set(ctx, buffer);
  }
  return buffer;
}

function pinkBuffer(ctx: AudioContext): AudioBuffer {
  let buffer = PINK.get(ctx);
  if (!buffer) {
    buffer = makePinkBuffer(ctx, 7);
    PINK.set(ctx, buffer);
  }
  return buffer;
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** 带阻尼的随机游走：比 LFO 更像真实的风、雨势、蝉鸣起伏。 */
function randomWalk(
  ctx: AudioContext,
  param: AudioParam,
  base: number,
  range: number,
  minWait = 1400,
  maxWait = 4200,
  timeConstant = 1.1,
): () => void {
  let stopped = false;
  let timer = 0;
  const step = (): void => {
    if (stopped) return;
    const target = Math.max(0, base + (Math.random() * 2 - 1) * range);
    param.setTargetAtTime(target, ctx.currentTime, timeConstant);
    timer = window.setTimeout(step, randomBetween(minWait, maxWait));
  };
  timer = window.setTimeout(step, 300);
  return () => {
    stopped = true;
    window.clearTimeout(timer);
  };
}

/** 随机间隔事件调度，返回清理函数。 */
function everyRandom(minDelay: number, maxDelay: number, run: () => void, first = 400): () => void {
  let stopped = false;
  let timer = 0;
  const tick = (): void => {
    if (stopped) return;
    run();
    timer = window.setTimeout(tick, randomBetween(minDelay, maxDelay));
  };
  timer = window.setTimeout(tick, first);
  return () => {
    stopped = true;
    window.clearTimeout(timer);
  };
}

/** 指数衰减噪声脉冲，用作混响核，给所有瞬态一个"户外空间"。 */
function makeImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      const t = i / length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  return buffer;
}

interface Space {
  /** 瞬态声源接到这里，会同时走干声与混响。 */
  input: GainNode;
  stop: () => void;
}

function createSpace(ctx: AudioContext, out: GainNode, wet: number): Space {
  const input = ctx.createGain();
  input.gain.value = 1;
  input.connect(out);

  const convolver = ctx.createConvolver();
  convolver.buffer = makeImpulse(ctx, 2.4, 2.8);
  const wetGain = ctx.createGain();
  wetGain.gain.value = wet;
  input.connect(convolver);
  convolver.connect(wetGain);
  wetGain.connect(out);

  return {
    input,
    stop: () => {
      try {
        input.disconnect();
        convolver.disconnect();
        wetGain.disconnect();
      } catch {
        // 已断开时忽略。
      }
    },
  };
}

function panned(ctx: AudioContext, pan: number): StereoPannerNode | GainNode {
  if (typeof ctx.createStereoPanner === 'function') {
    const node = ctx.createStereoPanner();
    node.pan.value = pan;
    return node;
  }
  return ctx.createGain();
}

interface BedOptions {
  pink?: boolean;
  gain: number;
  highpass?: number;
  lowpass?: number;
  bandpass?: { frequency: number; q: number } | null;
  walk?: { range: number; minWait?: number; maxWait?: number } | null;
  am?: { rate: number; depth: number } | null;
}

/** 一条立体声底噪：噪声 → 滤波 → 增益，可选随机游走与 AM。 */
function addBed(ctx: AudioContext, dest: AudioNode, options: BedOptions): () => void {
  const stops: Array<() => void> = [];
  const source = ctx.createBufferSource();
  source.buffer = options.pink ? pinkBuffer(ctx) : noiseBuffer(ctx);
  source.loop = true;

  let node: AudioNode = source;
  if (options.highpass) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = options.highpass;
    filter.Q.value = 0.6;
    node.connect(filter);
    node = filter;
  }
  if (options.lowpass) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = options.lowpass;
    filter.Q.value = 0.5;
    node.connect(filter);
    node = filter;
  }
  if (options.bandpass) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = options.bandpass.frequency;
    filter.Q.value = options.bandpass.q;
    node.connect(filter);
    node = filter;
  }

  const gain = ctx.createGain();
  gain.gain.value = options.gain;
  node.connect(gain);
  gain.connect(dest);
  source.start();
  stops.push(() => {
    try {
      source.stop();
    } catch {
      // 已停止。
    }
  });

  if (options.walk) {
    stops.push(
      randomWalk(
        ctx,
        gain.gain,
        options.gain,
        options.walk.range,
        options.walk.minWait,
        options.walk.maxWait,
      ),
    );
  }
  if (options.am) {
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = options.am.rate;
    const depth = ctx.createGain();
    depth.gain.value = options.am.depth;
    lfo.connect(depth);
    depth.connect(gain.gain);
    lfo.start();
    stops.push(() => lfo.stop());
  }

  return () => stops.forEach((fn) => fn());
}

/** 短噪声脉冲（雨滴、沙沙、水花）：带通 + 快速衰减。 */
function noiseBurst(
  ctx: AudioContext,
  dest: AudioNode,
  at: number,
  options: {
    frequency: number;
    q: number;
    peak: number;
    decay: number;
    pan?: number;
    attack?: number;
  },
): void {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx);
  source.loop = false;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = options.frequency;
  filter.Q.value = options.q;
  const gain = ctx.createGain();
  const attack = options.attack ?? 0.004;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.linearRampToValueAtTime(options.peak, at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + options.decay);
  const pan = panned(ctx, options.pan ?? 0);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(pan);
  pan.connect(dest);
  source.start(at, Math.random() * 2, options.decay + 0.05);
  source.stop(at + options.decay + 0.08);
}

/** 单个正弦音符（虫鸣脉冲、水泡、鸟叫），支持起止频率、颤音与声像。 */
function tone(
  ctx: AudioContext,
  dest: AudioNode,
  at: number,
  options: {
    from: number;
    to?: number;
    duration: number;
    peak: number;
    pan?: number;
    type?: OscillatorType;
    attack?: number;
    vibrato?: { rate: number; depth: number } | null;
  },
): void {
  const osc = ctx.createOscillator();
  osc.type = options.type ?? 'sine';
  osc.frequency.setValueAtTime(options.from, at);
  if (options.to && options.to !== options.from) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(60, options.to), at + options.duration);
  }
  const gain = ctx.createGain();
  const attack = options.attack ?? 0.006;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.linearRampToValueAtTime(options.peak, at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + options.duration);
  const pan = panned(ctx, options.pan ?? 0);
  osc.connect(gain);
  gain.connect(pan);
  pan.connect(dest);

  if (options.vibrato) {
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = options.vibrato.rate;
    const depth = ctx.createGain();
    depth.gain.value = options.vibrato.depth;
    lfo.connect(depth);
    depth.connect(osc.frequency);
    lfo.start(at);
    lfo.stop(at + options.duration + 0.05);
  }

  osc.start(at);
  osc.stop(at + options.duration + 0.06);
}

/** 雨滴：高频瞬态，密度与音高都随机。 */
function rainDrops(ctx: AudioContext, dest: AudioNode): () => void {
  return everyRandom(90, 260, () => {
    const now = ctx.currentTime;
    const count = Math.random() < 0.3 ? 2 : 1;
    for (let i = 0; i < count; i += 1) {
      noiseBurst(ctx, dest, now + Math.random() * 0.12, {
        frequency: randomBetween(2200, 6400),
        q: randomBetween(7, 18),
        peak: randomBetween(0.018, 0.05),
        decay: randomBetween(0.05, 0.16),
        pan: randomBetween(-0.85, 0.85),
      });
    }
  }, 120);
}

/** 蟋蟀：一"串"约 30Hz 的脉冲，比连续正弦更接近真实虫鸣。 */
function cricketChirp(
  ctx: AudioContext,
  dest: AudioNode,
  at: number,
  frequency: number,
  pan: number,
): void {
  const pulses = 3 + Math.floor(Math.random() * 3);
  const spacing = randomBetween(0.026, 0.034);
  for (let i = 0; i < pulses; i += 1) {
    tone(ctx, dest, at + i * spacing, {
      from: frequency,
      duration: 0.022,
      peak: 0.013,
      pan,
      attack: 0.004,
    });
  }
}

/** 鸟鸣：三四种短句，带滑音与颤音，远近各一层。 */
function birdCall(ctx: AudioContext, dest: AudioNode, pan: number, distant: boolean): void {
  const now = ctx.currentTime + Math.random() * 0.2;
  const notes = 2 + Math.floor(Math.random() * 3);
  const base = distant ? randomBetween(2000, 2900) : randomBetween(2500, 3600);
  const peak = distant ? 0.008 : 0.018;
  const shape = Math.random();
  for (let i = 0; i < notes; i += 1) {
    const at = now + i * randomBetween(0.09, 0.16);
    if (shape < 0.45) {
      // 上扬短哨
      tone(ctx, dest, at, {
        from: base,
        to: base * randomBetween(1.18, 1.45),
        duration: randomBetween(0.07, 0.12),
        peak,
        pan,
        vibrato: { rate: randomBetween(18, 30), depth: randomBetween(40, 120) },
      });
    } else if (shape < 0.8) {
      // 下滑滑音
      tone(ctx, dest, at, {
        from: base * 1.3,
        to: base * 0.86,
        duration: randomBetween(0.1, 0.18),
        peak: peak * 0.9,
        pan,
      });
    } else {
      // 两声短句
      tone(ctx, dest, at, { from: base * 0.7, duration: 0.16, peak, pan });
      tone(ctx, dest, at + 0.2, { from: base * 0.62, duration: 0.2, peak: peak * 0.8, pan });
    }
  }
}

function buildRain(ctx: AudioContext, out: GainNode): LayerHandle {
  const space = createSpace(ctx, out, 0.3);
  const stops: Array<() => void> = [space.stop];

  // 雨幕：立体声白噪 → 切掉刺耳高频与过闷低频
  stops.push(
    addBed(ctx, space.input, {
      gain: 0.26,
      highpass: 170,
      lowpass: 5200,
      walk: { range: 0.07, minWait: 1800, maxWait: 5200 },
    }),
  );
  // 雨的"沙沙"纹理，中心频率与音量都在缓慢游走
  stops.push(
    addBed(ctx, space.input, {
      bandpass: { frequency: 1700, q: 0.8 },
      gain: 0.1,
      walk: { range: 0.045, minWait: 1200, maxWait: 3600 },
    }),
  );
  // 远处雨声的空气感
  stops.push(
    addBed(ctx, out, {
      pink: true,
      gain: 0.06,
      highpass: 150,
      lowpass: 300,
      walk: { range: 0.02, minWait: 3000, maxWait: 7000 },
    }),
  );

  stops.push(rainDrops(ctx, space.input));

  // 很偶尔的远雷：低频噪声缓起缓落
  stops.push(
    everyRandom(70000, 150000, () => {
      const now = ctx.currentTime;
      const source = ctx.createBufferSource();
      source.buffer = pinkBuffer(ctx);
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 180;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.16, now + randomBetween(1.6, 3.2));
      gain.gain.exponentialRampToValueAtTime(0.0001, now + randomBetween(5, 8));
      const pan = panned(ctx, randomBetween(-0.5, 0.5));
      source.connect(filter);
      filter.connect(gain);
      gain.connect(pan);
      pan.connect(space.input);
      source.start(now);
      source.stop(now + 9);
    }, 20000),
  );

  return { stop: () => stops.forEach((fn) => fn()) };
}

function buildSnow(ctx: AudioContext, out: GainNode): LayerHandle {
  const space = createSpace(ctx, out, 0.2);
  const stops: Array<() => void> = [space.stop];

  stops.push(
    addBed(ctx, space.input, {
      pink: true,
      gain: 0.2,
      highpass: 210,
      lowpass: 3000,
      walk: { range: 0.055, minWait: 2400, maxWait: 6400 },
    }),
  );
  stops.push(
    addBed(ctx, out, {
      gain: 0.05,
      bandpass: { frequency: 6400, q: 0.8 },
      walk: { range: 0.02, minWait: 1800, maxWait: 4200 },
    }),
  );

  // 偶尔一阵风扫过：带通中心频率扫动 + 慢包络
  stops.push(
    everyRandom(12000, 26000, () => {
      const now = ctx.currentTime;
      const source = ctx.createBufferSource();
      source.buffer = noiseBuffer(ctx);
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 0.6;
      filter.frequency.setValueAtTime(320, now);
      filter.frequency.linearRampToValueAtTime(900, now + 2.4);
      filter.frequency.linearRampToValueAtTime(380, now + 5);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.05, now + 2);
      gain.gain.linearRampToValueAtTime(0.0001, now + 5.2);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(out);
      source.start(now);
      source.stop(now + 5.6);
    }, 6000),
  );

  return { stop: () => stops.forEach((fn) => fn()) };
}

function buildCloud(ctx: AudioContext, out: GainNode): LayerHandle {
  const space = createSpace(ctx, out, 0.18);
  const stops: Array<() => void> = [space.stop];
  stops.push(
    addBed(ctx, space.input, {
      pink: true,
      gain: 0.13,
      highpass: 110,
      lowpass: 480,
      walk: { range: 0.04, minWait: 3000, maxWait: 8000 },
    }),
  );
  stops.push(
    addBed(ctx, out, {
      gain: 0.03,
      bandpass: { frequency: 1200, q: 0.5 },
      walk: { range: 0.012, minWait: 4000, maxWait: 9000 },
    }),
  );
  // 高空的风：很轻的一层，让"云海"有空气流动感
  stops.push(
    addBed(ctx, out, {
      gain: 0.016,
      bandpass: { frequency: 1800, q: 0.7 },
      walk: { range: 0.008, minWait: 5000, maxWait: 11000 },
    }),
  );
  // 偶尔一阵缓慢的风涌
  stops.push(
    everyRandom(14000, 30000, () => {
      const now = ctx.currentTime;
      const source = ctx.createBufferSource();
      source.buffer = noiseBuffer(ctx);
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 0.6;
      filter.frequency.setValueAtTime(420, now);
      filter.frequency.linearRampToValueAtTime(880, now + 3.2);
      filter.frequency.linearRampToValueAtTime(460, now + 7);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.03, now + 2.6);
      gain.gain.linearRampToValueAtTime(0.0001, now + 7.2);
      const pan = panned(ctx, randomBetween(-0.4, 0.4));
      source.connect(filter);
      filter.connect(gain);
      gain.connect(pan);
      pan.connect(space.input);
      source.start(now);
      source.stop(now + 7.6);
    }, 8000),
  );
  return { stop: () => stops.forEach((fn) => fn()) };
}

function buildStarry(ctx: AudioContext, out: GainNode): LayerHandle {
  const space = createSpace(ctx, out, 0.26);
  const stops: Array<() => void> = [space.stop];

  stops.push(
    addBed(ctx, space.input, {
      pink: true,
      gain: 0.09,
      highpass: 160,
      lowpass: 460,
      walk: { range: 0.025, minWait: 3000, maxWait: 7000 },
    }),
  );

  // 三只蟋蟀：音高、声像、节奏各不相同
  const crickets = [
    { frequency: 4250, pan: -0.62, minDelay: 900, maxDelay: 2400 },
    { frequency: 4680, pan: 0.08, minDelay: 1300, maxDelay: 3200 },
    { frequency: 5150, pan: 0.58, minDelay: 1800, maxDelay: 4200 },
  ];
  for (const cricket of crickets) {
    stops.push(
      everyRandom(
        cricket.minDelay,
        cricket.maxDelay,
        () => {
          cricketChirp(
            ctx,
            space.input,
            ctx.currentTime + Math.random() * 0.1,
            cricket.frequency,
            cricket.pan,
          );
        },
        randomBetween(500, 3000),
      ),
    );
  }

  return { stop: () => stops.forEach((fn) => fn()) };
}

function buildCoast(ctx: AudioContext, out: GainNode): LayerHandle {
  const space = createSpace(ctx, out, 0.32);
  const stops: Array<() => void> = [space.stop];

  stops.push(
    addBed(ctx, space.input, {
      pink: true,
      gain: 0.16,
      highpass: 80,
      lowpass: 700,
      walk: { range: 0.05, minWait: 2600, maxWait: 6200 },
    }),
  );
  stops.push(
    addBed(ctx, out, {
      gain: 0.032,
      bandpass: { frequency: 900, q: 0.5 },
      walk: { range: 0.014, minWait: 2600, maxWait: 6000 },
    }),
  );

  // 浪：不规则的"涌起 → 铺开 → 退去"，泡沫声延后出现
  stops.push(
    everyRandom(6200, 13000, () => {
      const now = ctx.currentTime + Math.random() * 0.4;
      const rise = randomBetween(2.2, 3.6);
      const fall = randomBetween(3.2, 5);
      const pan = randomBetween(-0.45, 0.45);

      const swell = ctx.createBufferSource();
      swell.buffer = noiseBuffer(ctx);
      swell.loop = true;
      const swellFilter = ctx.createBiquadFilter();
      swellFilter.type = 'lowpass';
      swellFilter.Q.value = 0.7;
      swellFilter.frequency.setValueAtTime(280, now);
      swellFilter.frequency.linearRampToValueAtTime(randomBetween(1000, 1500), now + rise);
      swellFilter.frequency.linearRampToValueAtTime(320, now + rise + fall);
      const swellGain = ctx.createGain();
      swellGain.gain.setValueAtTime(0.0001, now);
      swellGain.gain.linearRampToValueAtTime(0.2, now + rise);
      swellGain.gain.exponentialRampToValueAtTime(0.0001, now + rise + fall);
      const swellPan = panned(ctx, pan);
      swell.connect(swellFilter);
      swellFilter.connect(swellGain);
      swellGain.connect(swellPan);
      swellPan.connect(space.input);
      swell.start(now);
      swell.stop(now + rise + fall + 0.2);

      const foam = ctx.createBufferSource();
      foam.buffer = noiseBuffer(ctx);
      foam.loop = true;
      const foamFilter = ctx.createBiquadFilter();
      foamFilter.type = 'bandpass';
      foamFilter.frequency.value = randomBetween(1900, 2600);
      foamFilter.Q.value = 0.8;
      const foamGain = ctx.createGain();
      const foamAt = now + rise * 0.75;
      foamGain.gain.setValueAtTime(0.0001, foamAt);
      foamGain.gain.linearRampToValueAtTime(0.085, foamAt + 0.5);
      foamGain.gain.exponentialRampToValueAtTime(0.0001, foamAt + 2.8);
      const foamPan = panned(ctx, pan * 0.8);
      foam.connect(foamFilter);
      foamFilter.connect(foamGain);
      foamGain.connect(foamPan);
      foamPan.connect(space.input);
      foam.start(foamAt);
      foam.stop(foamAt + 3.2);
    }, 4200),
  );

  return { stop: () => stops.forEach((fn) => fn()) };
}

function buildDawn(ctx: AudioContext, out: GainNode): LayerHandle {
  const space = createSpace(ctx, out, 0.26);
  const stops: Array<() => void> = [space.stop];

  stops.push(
    addBed(ctx, space.input, {
      pink: true,
      gain: 0.1,
      highpass: 150,
      lowpass: 820,
      walk: { range: 0.03, minWait: 3000, maxWait: 7000 },
    }),
  );

  stops.push(
    everyRandom(
      2400,
      6400,
      () => {
        birdCall(ctx, space.input, randomBetween(-0.8, 0.8), false);
      },
      1500,
    ),
  );
  // 远处还有一圈鸟，音量更轻
  stops.push(
    everyRandom(
      5200,
      12000,
      () => {
        birdCall(ctx, space.input, randomBetween(-1, 1), true);
      },
      4000,
    ),
  );

  return { stop: () => stops.forEach((fn) => fn()) };
}

function buildSummer(ctx: AudioContext, out: GainNode): LayerHandle {
  const space = createSpace(ctx, out, 0.22);
  const stops: Array<() => void> = [space.stop];

  // 蝉：两路窄带噪声各自以不同频率起伏
  stops.push(
    addBed(ctx, space.input, {
      bandpass: { frequency: 4800, q: 11 },
      gain: 0.028,
      am: { rate: 52, depth: 0.016 },
      walk: { range: 0.012, minWait: 2200, maxWait: 6000 },
    }),
  );
  stops.push(
    addBed(ctx, out, {
      bandpass: { frequency: 5600, q: 14 },
      gain: 0.016,
      am: { rate: 67, depth: 0.009 },
      walk: { range: 0.008, minWait: 2600, maxWait: 7000 },
    }),
  );
  // 树叶与远处的风
  stops.push(
    addBed(ctx, out, {
      gain: 0.038,
      highpass: 2400,
      lowpass: 6200,
      walk: { range: 0.018, minWait: 1600, maxWait: 4200 },
    }),
  );
  // 偶尔一声远鸟
  stops.push(
    everyRandom(
      9000,
      21000,
      () => {
        birdCall(ctx, space.input, randomBetween(-1, 1), true);
      },
      7000,
    ),
  );

  return { stop: () => stops.forEach((fn) => fn()) };
}

function buildPool(ctx: AudioContext, out: GainNode): LayerHandle {
  const space = createSpace(ctx, out, 0.28);
  const stops: Array<() => void> = [space.stop];

  stops.push(
    addBed(ctx, space.input, {
      pink: true,
      gain: 0.14,
      highpass: 120,
      lowpass: 900,
      walk: { range: 0.045, minWait: 1800, maxWait: 4600 },
    }),
  );
  stops.push(
    addBed(ctx, out, {
      gain: 0.02,
      bandpass: { frequency: 2800, q: 0.9 },
      walk: { range: 0.01, minWait: 2000, maxWait: 5000 },
    }),
  );

  // 水泡：短促上扬的音，带随机声像
  stops.push(
    everyRandom(700, 2600, () => {
      const now = ctx.currentTime + Math.random() * 0.2;
      const count = Math.random() < 0.25 ? 2 : 1;
      for (let i = 0; i < count; i += 1) {
        tone(ctx, space.input, now + i * randomBetween(0.08, 0.16), {
          from: randomBetween(620, 900),
          to: randomBetween(1000, 1400),
          duration: randomBetween(0.05, 0.1),
          peak: randomBetween(0.008, 0.016),
          pan: randomBetween(-0.7, 0.7),
        });
      }
    }, 500),
  );

  // 偶尔的落水/溅水
  stops.push(
    everyRandom(9000, 22000, () => {
      const now = ctx.currentTime;
      noiseBurst(ctx, space.input, now, {
        frequency: randomBetween(1600, 2400),
        q: 1.1,
        peak: 0.05,
        decay: randomBetween(0.25, 0.45),
        pan: randomBetween(-0.6, 0.6),
        attack: 0.01,
      });
      tone(ctx, space.input, now + 0.02, {
        from: randomBetween(500, 700),
        to: randomBetween(260, 420),
        duration: 0.12,
        peak: 0.02,
        pan: randomBetween(-0.5, 0.5),
      });
    }, 6000),
  );

  return { stop: () => stops.forEach((fn) => fn()) };
}

function buildWheat(ctx: AudioContext, out: GainNode): LayerHandle {
  const space = createSpace(ctx, out, 0.24);
  const stops: Array<() => void> = [space.stop];

  stops.push(
    addBed(ctx, space.input, {
      pink: true,
      gain: 0.18,
      highpass: 100,
      lowpass: 700,
      walk: { range: 0.05, minWait: 2600, maxWait: 6400 },
    }),
  );
  stops.push(
    addBed(ctx, out, {
      gain: 0.045,
      bandpass: { frequency: 3000, q: 0.9 },
      walk: { range: 0.02, minWait: 1500, maxWait: 4000 },
    }),
  );

  // 麦浪扫过：带通扫频 + 慢包络
  stops.push(
    everyRandom(5200, 12000, () => {
      const now = ctx.currentTime;
      const source = ctx.createBufferSource();
      source.buffer = noiseBuffer(ctx);
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 0.9;
      const from = randomBetween(1600, 2200);
      filter.frequency.setValueAtTime(from, now);
      filter.frequency.linearRampToValueAtTime(from * randomBetween(1.6, 2.1), now + 1.2);
      filter.frequency.linearRampToValueAtTime(from * 0.8, now + 2.4);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.05, now + 0.9);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.4);
      const pan = panned(ctx, randomBetween(-0.7, 0.7));
      source.connect(filter);
      filter.connect(gain);
      gain.connect(pan);
      pan.connect(space.input);
      source.start(now);
      source.stop(now + 2.8);
    }, 3000),
  );

  // 稀疏的虫鸣点缀
  stops.push(
    everyRandom(4200, 11000, () => {
      const now = ctx.currentTime + Math.random() * 0.3;
      const ticks = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < ticks; i += 1) {
        noiseBurst(ctx, space.input, now + i * 0.05, {
          frequency: randomBetween(4200, 5200),
          q: 14,
          peak: 0.01,
          decay: 0.02,
          pan: randomBetween(-0.6, 0.6),
        });
      }
    }, 4000),
  );

  return { stop: () => stops.forEach((fn) => fn()) };
}

const BUILDERS: Record<AmbientPreset, (ctx: AudioContext, out: GainNode) => LayerHandle> = {
  rain: buildRain,
  snow: buildSnow,
  cloud: buildCloud,
  starry: buildStarry,
  coast: buildCoast,
  dawn: buildDawn,
  summer: buildSummer,
  pool: buildPool,
  wheat: buildWheat,
};

export interface AmbientEngine {
  setPreset: (preset: AmbientPreset) => void;
  setVolume: (value: number) => void;
  resume: () => Promise<void>;
  dispose: () => void;
  isRunning: () => boolean;
}

/**
 * 创建环境音引擎。九套场景各自对应合成环境音。
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
    try {
      layer = BUILDERS[nextPreset](context, master);
    } catch {
      // 任何一层构建失败都不该让整页静音。
      layer = null;
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
