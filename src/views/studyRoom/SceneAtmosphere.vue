<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { getStudyRoomSceneCopy, type StudyRoomScene } from './study-room-scene';

const props = defineProps<{
  scene: StudyRoomScene;
}>();

type ParticleKind = 'rain' | 'snow' | 'star' | 'pollen' | 'sparkle' | 'mist';

interface Particle {
  kind: ParticleKind;
  /** 0=远景 1=中景 2=近景，决定大小、速度与不透明度 */
  layer: 0 | 1 | 2;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  phase: number;
  swayRate: number;
  drift: number;
}

interface EffectConfig {
  kind: ParticleKind;
  count: number;
  color: 'primary' | 'secondary' | '#ffffff';
  alpha: number;
}

const EFFECTS: Record<StudyRoomScene, EffectConfig> = {
  rain: { kind: 'rain', count: 56, color: 'secondary', alpha: 0.3 },
  snow: { kind: 'snow', count: 58, color: '#ffffff', alpha: 0.6 },
  cloud: { kind: 'mist', count: 10, color: '#ffffff', alpha: 0.07 },
  starry: { kind: 'star', count: 56, color: '#ffffff', alpha: 0.8 },
  coast: { kind: 'sparkle', count: 40, color: 'secondary', alpha: 0.46 },
  dawn: { kind: 'pollen', count: 32, color: 'primary', alpha: 0.4 },
  summer: { kind: 'pollen', count: 34, color: 'primary', alpha: 0.42 },
  pool: { kind: 'sparkle', count: 40, color: 'secondary', alpha: 0.5 },
  wheat: { kind: 'pollen', count: 34, color: 'primary', alpha: 0.44 },
};

/** 远景粒子压暗压小，近景更亮更大，形成景深。 */
const LAYER_SCALE = [0.6, 1, 1.4];
const LAYER_ALPHA = [0.5, 1, 1.1];
const LAYER_SPEED = [0.6, 1, 1.35];

const canvasRef = ref<HTMLCanvasElement | null>(null);
const bgStyle = computed(() => ({
  backgroundImage: `url('/images/study-room/${props.scene}.webp')`,
}));

let ctx: CanvasRenderingContext2D | null = null;
let particles: Particle[] = [];
let particleColor = { r: 255, g: 255, b: 255 };
let width = 0;
let height = 0;
let dpr = 1;
let frame = 0;
let last = 0;
let running = false;
let reducedMotion = false;
let resizeObserver: ResizeObserver | null = null;
let motionQuery: MediaQueryList | null = null;

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const raw = hex.replace('#', '');
  const normalized =
    raw.length === 3
      ? raw
          .split('')
          .map((char) => char + char)
          .join('')
      : raw;
  const value = Number.parseInt(normalized, 16);
  if (!Number.isFinite(value)) return { r: 255, g: 255, b: 255 };
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function random(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomLayer(): 0 | 1 | 2 {
  const roll = Math.random();
  if (roll < 0.4) return 0;
  return roll < 0.8 ? 1 : 2;
}

function createParticle(config: EffectConfig): Particle {
  const { kind } = config;
  const layer = kind === 'star' ? (Math.random() < 0.7 ? (0 as const) : (1 as const)) : randomLayer();
  const base: Particle = {
    kind,
    layer,
    x: Math.random() * width,
    y: Math.random() * height,
    vx: 0,
    vy: 0,
    size: 1,
    alpha: config.alpha,
    phase: Math.random() * Math.PI * 2,
    swayRate: random(0.4, 1.2),
    drift: 0,
  };
  const scale = LAYER_SCALE[layer];
  const alphaScale = LAYER_ALPHA[layer];
  const speedScale = LAYER_SPEED[layer];

  if (kind === 'rain') {
    return {
      ...base,
      vx: random(-46, -18) * speedScale,
      vy: random(320, 560) * speedScale,
      size: random(10, 24) * (0.7 + scale * 0.5),
      alpha: Math.min(0.46, random(0.1, config.alpha) * alphaScale),
    };
  }
  if (kind === 'snow') {
    return {
      ...base,
      vx: random(-8, 8),
      vy: random(12, 38) * speedScale,
      size: random(0.9, 2.6) * scale,
      alpha: Math.min(0.8, random(0.28, config.alpha) * alphaScale),
      drift: random(6, 20) * scale,
      swayRate: random(0.25, 0.85),
    };
  }
  if (kind === 'star') {
    return {
      ...base,
      y: Math.random() * height * 0.58,
      size: random(0.5, 1.7) * scale,
      alpha: Math.min(0.9, random(0.24, config.alpha) * alphaScale),
    };
  }
  if (kind === 'pollen') {
    return {
      ...base,
      vx: random(4, 16) * speedScale,
      vy: random(-7, 1) * speedScale,
      size: random(0.9, 2.5) * scale,
      alpha: Math.min(0.65, random(0.22, config.alpha) * alphaScale),
      drift: random(4, 13) * scale,
    };
  }
  if (kind === 'sparkle') {
    return {
      ...base,
      vx: random(2, 12) * speedScale,
      vy: random(-7, -1) * speedScale,
      size: random(0.7, 2.1) * scale,
      alpha: Math.min(0.7, random(0.15, config.alpha) * alphaScale),
    };
  }
  // mist：大范围柔光云影
  return {
    ...base,
    vx: random(1.5, 6) * speedScale,
    vy: random(-1.1, 1.1),
    size: random(120, 300) * (layer === 0 ? 1.5 : 1),
    alpha: random(0.03, config.alpha) * (layer === 0 ? 1.2 : 1),
  };
}

function initParticles(): void {
  const config = EFFECTS[props.scene];
  const copy = getStudyRoomSceneCopy(props.scene);
  particleColor = hexToRgb(
    config.color === 'primary'
      ? copy.primary
      : config.color === 'secondary'
        ? copy.secondary
        : config.color,
  );
  const count = Math.round(config.count * (width < 720 ? 0.55 : 1));
  particles = Array.from({ length: count }, () => createParticle(config));
}

function resize(): void {
  const canvas = canvasRef.value;
  const host = canvas?.parentElement;
  if (!canvas || !host) return;
  width = Math.max(1, host.clientWidth);
  height = Math.max(1, host.clientHeight);
  dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  initParticles();
}

/** 慢速风场：雨丝角度与雪花飘向共用，避免各飘各的。 */
function gustAt(seconds: number): number {
  return (
    0.55 +
    0.3 * Math.sin(seconds * 0.13) +
    0.15 * Math.sin(seconds * 0.071 + 1.7)
  );
}

function paint(color: { r: number; g: number; b: number }, alpha: number): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha.toFixed(3)})`;
}

function draw(now: number, dt: number): void {
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  const seconds = now / 1000;
  const gust = gustAt(seconds);

  for (const particle of particles) {
    if (particle.kind === 'rain') {
      const wind = gust * 60 * LAYER_SPEED[particle.layer];
      particle.x += (particle.vx + wind) * dt;
      particle.y += particle.vy * dt;
      if (particle.y > height + particle.size) {
        particle.y = -particle.size;
        particle.x = Math.random() * width;
      }
      if (particle.x < -20) particle.x = width + 20;
      if (particle.x > width + 20) particle.x = -20;
      ctx.beginPath();
      ctx.strokeStyle = paint(particleColor, particle.alpha);
      ctx.lineWidth = particle.layer === 2 ? 1.4 : particle.layer === 1 ? 1 : 0.6;
      ctx.moveTo(particle.x, particle.y);
      ctx.lineTo(particle.x - particle.size * 0.18, particle.y + particle.size);
      ctx.stroke();
      continue;
    }

    if (particle.kind === 'snow') {
      particle.x +=
        (particle.vx +
          Math.sin(seconds * particle.swayRate + particle.phase) * particle.drift +
          (gust - 0.55) * 18) *
        dt;
      particle.y += particle.vy * dt;
      if (particle.y > height + 6) {
        particle.y = -6;
        particle.x = Math.random() * width;
      }
      if (particle.x < -6) particle.x = width + 6;
      if (particle.x > width + 6) particle.x = -6;
      if (particle.layer === 2) {
        // 近景雪花虚焦：先一层柔光再叠实体，才有景深。
        ctx.beginPath();
        ctx.fillStyle = paint(particleColor, particle.alpha * 0.35);
        ctx.arc(particle.x, particle.y, particle.size * 2.1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.fillStyle = paint(particleColor, particle.alpha);
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    if (particle.kind === 'star') {
      const twinkle =
        particle.alpha *
        (0.55 +
          0.3 * Math.sin(seconds * 1.4 + particle.phase) +
          0.15 * Math.sin(seconds * 3.7 + particle.phase * 1.7));
      ctx.beginPath();
      ctx.fillStyle = paint(particleColor, Math.max(0.05, twinkle));
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    if (particle.kind === 'pollen') {
      particle.x += particle.vx * dt;
      particle.y +=
        (particle.vy +
          Math.sin(seconds * particle.swayRate + particle.phase) * particle.drift) *
        dt;
      if (particle.x > width + 8) particle.x = -8;
      if (particle.y < -8) particle.y = height + 8;
      if (particle.y > height + 8) particle.y = -8;
      const shimmer =
        particle.alpha * (0.75 + 0.25 * Math.sin(seconds * 1.9 + particle.phase));
      ctx.beginPath();
      ctx.fillStyle = paint(particleColor, shimmer);
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    if (particle.kind === 'sparkle') {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      if (particle.x > width + 8) particle.x = -8;
      if (particle.y < -8) particle.y = height + 8;
      const twinkle =
        particle.alpha *
        (0.35 +
          0.4 * Math.sin(seconds * 2.1 + particle.phase) +
          0.25 * Math.sin(seconds * 5.3 + particle.phase * 2.2));
      ctx.beginPath();
      ctx.fillStyle = paint(particleColor, Math.max(0.04, twinkle));
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    // mist
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    if (particle.x > width + particle.size) particle.x = -particle.size;
    if (particle.y > height + particle.size) particle.y = -particle.size;
    if (particle.y < -particle.size) particle.y = height + particle.size;
    const breath = 0.8 + 0.2 * Math.sin(seconds * 0.1 + particle.phase);
    const gradient = ctx.createRadialGradient(
      particle.x,
      particle.y,
      0,
      particle.x,
      particle.y,
      particle.size,
    );
    gradient.addColorStop(0, paint(particleColor, particle.alpha * breath));
    gradient.addColorStop(1, paint(particleColor, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function tick(now: number): void {
  if (!running) return;
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  if (!document.hidden) draw(now, dt);
  frame = requestAnimationFrame(tick);
}

function start(): void {
  if (running || reducedMotion) return;
  running = true;
  last = performance.now();
  frame = requestAnimationFrame(tick);
}

function stop(): void {
  running = false;
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
}

function handleVisibility(): void {
  if (document.hidden) stop();
  else start();
}

function handleMotionPreference(): void {
  reducedMotion = motionQuery?.matches ?? false;
  if (reducedMotion) {
    stop();
    if (ctx) ctx.clearRect(0, 0, width, height);
  } else {
    start();
  }
}

watch(
  () => props.scene,
  () => {
    initParticles();
  },
);

onMounted(() => {
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion = motionQuery.matches;
  resize();
  if (canvasRef.value?.parentElement) {
    resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(canvasRef.value.parentElement);
  }
  motionQuery.addEventListener('change', handleMotionPreference);
  document.addEventListener('visibilitychange', handleVisibility);
  start();
});

onBeforeUnmount(() => {
  stop();
  resizeObserver?.disconnect();
  resizeObserver = null;
  motionQuery?.removeEventListener('change', handleMotionPreference);
  document.removeEventListener('visibilitychange', handleVisibility);
  ctx = null;
});
</script>

<template>
  <div class="scene-atmosphere" :data-scene="scene" aria-hidden="true">
    <div class="scene-bg" :style="bgStyle" />
    <div class="scene-tint" />
    <div class="scene-glow" />
    <canvas ref="canvasRef" class="scene-particles" />
  </div>
</template>

<style scoped>
.scene-atmosphere {
  position: absolute;
  z-index: 0;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.scene-bg,
.scene-tint,
.scene-glow,
.scene-particles {
  position: absolute;
  inset: 0;
}

/* 只保留一层很慢的推拉，幅度压到最小，避免整屏位移引起眩晕 */
.scene-bg {
  inset: -6%;
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
  animation: scene-drift 72s ease-in-out infinite alternate;
  transform: translateZ(0);
  will-change: transform;
}

.scene-tint {
  background: linear-gradient(
    180deg,
    color-mix(
        in srgb,
        var(--study-room-secondary, #5ab8b0) 22%,
        rgb(0 0 0 / 0.6)
      )
      0%,
    rgb(0 0 0 / 0.34) 42%,
    color-mix(
        in srgb,
        var(--study-room-primary, #d7ef83) 16%,
        rgb(0 0 0 / 0.65)
      )
      100%
  );
}

.scene-glow {
  background:
    radial-gradient(
      circle at 16% 10%,
      color-mix(in srgb, var(--study-room-primary, #d7ef83) 14%, transparent),
      transparent 42%
    ),
    radial-gradient(
      circle at 84% 84%,
      color-mix(in srgb, var(--study-room-secondary, #5ab8b0) 16%, transparent),
      transparent 52%
    );
  opacity: 0.85;
}

.scene-particles {
  width: 100%;
  height: 100%;
}

.scene-atmosphere[data-scene='rain'] .scene-bg {
  animation-duration: 64s;
}

.scene-atmosphere[data-scene='snow'] .scene-bg {
  animation-duration: 80s;
}

.scene-atmosphere[data-scene='cloud'] .scene-bg {
  animation-duration: 96s;
}

.scene-atmosphere[data-scene='starry'] .scene-bg {
  animation-duration: 104s;
}

.scene-atmosphere[data-scene='coast'] .scene-bg {
  animation-duration: 72s;
}

.scene-atmosphere[data-scene='dawn'] .scene-bg {
  animation-duration: 88s;
}

.scene-atmosphere[data-scene='summer'] .scene-bg {
  animation-duration: 68s;
}

.scene-atmosphere[data-scene='pool'] .scene-bg {
  animation-duration: 72s;
}

.scene-atmosphere[data-scene='wheat'] .scene-bg {
  animation-duration: 78s;
}

@keyframes scene-drift {
  from {
    transform: scale(1.02) translate3d(-0.3%, -0.2%, 0);
  }

  to {
    transform: scale(1.05) translate3d(0.3%, 0.2%, 0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .scene-bg {
    animation: none;
    transform: none;
  }
}
</style>
