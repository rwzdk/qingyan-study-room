<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { getStudyRoomSceneCopy, type StudyRoomScene } from './study-room-scene';

const props = defineProps<{
  scene: StudyRoomScene;
}>();

type ParticleKind = 'rain' | 'snow' | 'star' | 'pollen' | 'sparkle' | 'mist';

interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  phase: number;
  drift: number;
}

interface EffectConfig {
  kind: ParticleKind;
  count: number;
  color: 'primary' | 'secondary' | '#ffffff';
  alpha: number;
}

const EFFECTS: Record<StudyRoomScene, EffectConfig> = {
  rain: { kind: 'rain', count: 52, color: 'secondary', alpha: 0.32 },
  snow: { kind: 'snow', count: 42, color: '#ffffff', alpha: 0.62 },
  cloud: { kind: 'mist', count: 7, color: '#ffffff', alpha: 0.07 },
  starry: { kind: 'star', count: 56, color: '#ffffff', alpha: 0.82 },
  coast: { kind: 'sparkle', count: 34, color: 'secondary', alpha: 0.5 },
  dawn: { kind: 'pollen', count: 30, color: 'primary', alpha: 0.45 },
  summer: { kind: 'pollen', count: 34, color: 'primary', alpha: 0.5 },
  pool: { kind: 'sparkle', count: 38, color: 'secondary', alpha: 0.55 },
  wheat: { kind: 'pollen', count: 32, color: 'primary', alpha: 0.5 },
};

const canvasRef = ref<HTMLCanvasElement | null>(null);
const bgStyle = computed(() => ({
  backgroundImage: `url('/images/study-room/${props.scene}.webp')`,
}));

let ctx: CanvasRenderingContext2D | null = null;
let particles: Particle[] = [];
let particleColor = '#ffffff';
let width = 0;
let height = 0;
let dpr = 1;
let frame = 0;
let last = 0;
let running = false;
let reducedMotion = false;
let resizeObserver: ResizeObserver | null = null;
let motionQuery: MediaQueryList | null = null;

function rgba(hex: string, alpha: number): string {
  const raw = hex.replace('#', '');
  const normalized =
    raw.length === 3
      ? raw
          .split('')
          .map((char) => char + char)
          .join('')
      : raw;
  const value = Number.parseInt(normalized, 16);
  if (!Number.isFinite(value)) return `rgba(255, 255, 255, ${alpha})`;
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function random(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function createParticle(config: EffectConfig): Particle {
  const { kind } = config;
  const base = {
    kind,
    x: Math.random() * width,
    y: Math.random() * height,
    vx: 0,
    vy: 0,
    size: 1,
    alpha: config.alpha,
    phase: Math.random() * Math.PI * 2,
    drift: 0,
  };

  if (kind === 'rain') {
    return {
      ...base,
      vx: random(-42, -16),
      vy: random(360, 620),
      size: random(10, 26),
      alpha: random(0.16, config.alpha),
    };
  }
  if (kind === 'snow') {
    return {
      ...base,
      vx: random(-8, 8),
      vy: random(16, 52),
      size: random(1, 2.8),
      alpha: random(0.32, config.alpha),
      drift: random(6, 18),
    };
  }
  if (kind === 'star') {
    return {
      ...base,
      // 星点只落在天空区域，避免落在桌面和小岛上像雪粒。
      y: Math.random() * height * 0.56,
      size: random(0.6, 1.8),
      alpha: random(0.28, config.alpha),
    };
  }
  if (kind === 'pollen') {
    return {
      ...base,
      vx: random(5, 17),
      vy: random(-6, 1),
      size: random(1, 2.6),
      alpha: random(0.26, config.alpha),
      drift: random(4, 12),
    };
  }
  if (kind === 'sparkle') {
    return {
      ...base,
      vx: random(3, 12),
      vy: random(-6, -1),
      size: random(0.8, 2.2),
      alpha: random(0.18, config.alpha),
    };
  }
  // mist
  return {
    ...base,
    vx: random(3, 9),
    vy: random(-1.5, 1.5),
    size: random(80, 220),
    alpha: random(0.035, config.alpha),
  };
}

function initParticles(): void {
  const config = EFFECTS[props.scene];
  const copy = getStudyRoomSceneCopy(props.scene);
  particleColor =
    config.color === 'primary'
      ? copy.primary
      : config.color === 'secondary'
        ? copy.secondary
        : config.color;
  const count = Math.round(
    config.count * (width < 720 ? 0.62 : 1),
  );
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

function draw(now: number, dt: number): void {
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  const seconds = now / 1000;
  const color = particleColor;

  for (const particle of particles) {
    if (particle.kind === 'rain') {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      if (particle.y > height + particle.size) {
        particle.y = -particle.size;
        particle.x = Math.random() * width;
      }
      if (particle.x < -10) particle.x = width + 10;
      if (particle.x > width + 10) particle.x = -10;
      ctx.beginPath();
      ctx.strokeStyle = rgba(color, particle.alpha);
      ctx.lineWidth = 1;
      ctx.moveTo(particle.x, particle.y);
      ctx.lineTo(particle.x - 4, particle.y + particle.size);
      ctx.stroke();
      continue;
    }

    if (particle.kind === 'snow') {
      particle.x +=
        (particle.vx + Math.sin(seconds * 0.8 + particle.phase) * particle.drift) *
        dt;
      particle.y += particle.vy * dt;
      if (particle.y > height + 4) {
        particle.y = -4;
        particle.x = Math.random() * width;
      }
      if (particle.x < -4) particle.x = width + 4;
      if (particle.x > width + 4) particle.x = -4;
      ctx.beginPath();
      ctx.fillStyle = rgba(color, particle.alpha);
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    if (particle.kind === 'star') {
      const twinkle =
        particle.alpha *
        (0.42 + 0.58 * (0.5 + 0.5 * Math.sin(seconds * 1.5 + particle.phase)));
      ctx.beginPath();
      ctx.fillStyle = rgba(color, twinkle);
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    if (particle.kind === 'pollen') {
      particle.x += particle.vx * dt;
      particle.y +=
        (particle.vy + Math.sin(seconds * 0.7 + particle.phase) * particle.drift) *
        dt;
      if (particle.x > width + 8) particle.x = -8;
      if (particle.y < -8) particle.y = height + 8;
      if (particle.y > height + 8) particle.y = -8;
      ctx.beginPath();
      ctx.fillStyle = rgba(color, particle.alpha);
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
        (0.3 + 0.7 * (0.5 + 0.5 * Math.sin(seconds * 2.1 + particle.phase)));
      ctx.beginPath();
      ctx.fillStyle = rgba(color, twinkle);
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    // mist：大范围、低透明度的缓慢漂移云影
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    if (particle.x > width + particle.size) particle.x = -particle.size;
    if (particle.y > height + particle.size) particle.y = -particle.size;
    if (particle.y < -particle.size) particle.y = height + particle.size;
    const gradient = ctx.createRadialGradient(
      particle.x,
      particle.y,
      0,
      particle.x,
      particle.y,
      particle.size,
    );
    gradient.addColorStop(0, rgba(color, particle.alpha));
    gradient.addColorStop(1, rgba(color, 0));
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

.scene-bg {
  inset: -6%;
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
  animation: scene-drift 52s ease-in-out infinite alternate;
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
      color-mix(
        in srgb,
        var(--study-room-primary, #d7ef83) 14%,
        transparent
      ),
      transparent 42%
    ),
    radial-gradient(
      circle at 84% 84%,
      color-mix(
        in srgb,
        var(--study-room-secondary, #5ab8b0) 16%,
        transparent
      ),
      transparent 52%
    );
  opacity: 0.85;
}

.scene-particles {
  width: 100%;
  height: 100%;
}

.scene-atmosphere[data-scene='rain'] .scene-bg {
  animation-duration: 46s;
}

.scene-atmosphere[data-scene='snow'] .scene-bg {
  animation-duration: 58s;
}

.scene-atmosphere[data-scene='cloud'] .scene-bg {
  animation-duration: 72s;
}

.scene-atmosphere[data-scene='starry'] .scene-bg {
  animation-duration: 82s;
}

.scene-atmosphere[data-scene='coast'] .scene-bg {
  animation-duration: 50s;
}

.scene-atmosphere[data-scene='dawn'] .scene-bg {
  animation-duration: 64s;
}

.scene-atmosphere[data-scene='summer'] .scene-bg {
  animation-duration: 44s;
}

.scene-atmosphere[data-scene='pool'] .scene-bg {
  animation-duration: 48s;
}

.scene-atmosphere[data-scene='wheat'] .scene-bg {
  animation-duration: 56s;
}

@keyframes scene-drift {
  from {
    transform: scale(1.03) translate3d(-0.5%, -0.35%, 0);
  }

  to {
    transform: scale(1.085) translate3d(0.5%, 0.35%, 0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .scene-bg {
    animation: none;
    transform: none;
  }
}
</style>
