<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import type { StudyRoomScene } from './study-room-scene';

// ─────────────────────────────────────────────────────────────
// 常量 / 类型 / 地块生成（复刻 summer-checkin 的 React 版本）
// ─────────────────────────────────────────────────────────────

const UNIT = 0.34;
const GRID_X = { min: -12, max: 12 };
const GRID_Z = { min: -8, max: 8 };

type TileKind = 'forest' | 'moss' | 'water' | 'rock' | 'river' | 'village' | 'waterfall';

interface Tile {
  x: number;
  z: number;
  height: number;
  elevation: number;
  delay: number;
  kind: TileKind;
  unlockOrder: number;
  /** 浮动幅度（世界单位）：每块独立，让整座岛像悬浮的方块云。 */
  floatAmp: number;
  /** 浮动相位（弧度）：错开后不会整岛同步上下移动。 */
  floatPhase: number;
  /** 所属簇（Voronoi 分区），用于整块错位，做出"分割浮空"的观感。 */
  cluster: number;
}

type SceneType = StudyRoomScene;

interface Props {
  totalCheckins?: number;
  todayCheckins?: number;
  scene?: SceneType;
}

const props = withDefaults(defineProps<Props>(), {
  totalCheckins: 0,
  todayCheckins: 0,
  scene: 'rain',
});

// ── 调色板（只保留组件实际用到的字段；mountain 系列未实现故剔除）──
interface Palette {
  treeTrunk: string;
  treeCrown1: string;
  treeCrown2: string;
  treeCrown3: string;
  treeCrown4: string;
  fern1: string;
  fern2: string;
  rock1: string;
  rock2: string;
  pond: string;
  pondFlower: string;
  waterTop: string;
  rockTop: string;
  mossTop: string;
  forestTop: string;
  tileSide: string;
  riverTop: string;
  riverEmissive: string;
  villageWall: string;
  villageRoof: string;
  villageTop: string;
  sceneSky: string;
  sceneGround: string;
  sceneIntensity: number;
}

const PALETTE_RAIN: Palette = {
  treeTrunk: '#6b5a3e',
  treeCrown1: '#4d9e6a',
  treeCrown2: '#5ead78',
  treeCrown3: '#6dbf8a',
  treeCrown4: '#82cf9d',
  fern1: '#55a870',
  fern2: '#6dbd85',
  rock1: '#5e8a6e',
  rock2: '#789d80',
  pond: '#6ec98a',
  pondFlower: '#e8bbc8',
  waterTop: '#5ab8b0',
  rockTop: '#649075',
  mossTop: '#6dbd85',
  forestTop: '#5eaa78',
  tileSide: '#244839',
  riverTop: '#3b9ec8',
  riverEmissive: '#0a2a3a',
  villageWall: '#d4c8a8',
  villageRoof: '#c47a4a',
  villageTop: '#8a9e7a',
  sceneSky: '#d4f0e0',
  sceneGround: '#0d241a',
  sceneIntensity: 1.3,
};

const PALETTE_SNOW: Palette = {
  treeTrunk: '#7a6e62',
  treeCrown1: '#f4f8fb',
  treeCrown2: '#e4eaf0',
  treeCrown3: '#d0dae6',
  treeCrown4: '#c0cee0',
  fern1: '#d0dae6',
  fern2: '#e4eaf0',
  rock1: '#5a6a7c',
  rock2: '#7a8a9c',
  pond: '#c0cee0',
  pondFlower: '#e4eaf0',
  waterTop: '#9ab0c8',
  rockTop: '#d0dae6',
  mossTop: '#e4eaf0',
  forestTop: '#d8e2ee',
  tileSide: '#2e3e4e',
  riverTop: '#d0dae6',
  riverEmissive: '#1a2a38',
  villageWall: '#e8ddd0',
  villageRoof: '#a89888',
  villageTop: '#f0f4f8',
  sceneSky: '#f0f5f9',
  sceneGround: '#1e2e3e',
  sceneIntensity: 1.22,
};

const PALETTE_CLOUD: Palette = {
  treeTrunk: '#8a7a62',
  treeCrown1: '#faf4e4',
  treeCrown2: '#f2e8cc',
  treeCrown3: '#e8dcba',
  treeCrown4: '#dcd0a6',
  fern1: '#d8dfc4',
  fern2: '#e8ecd4',
  rock1: '#aaa08a',
  rock2: '#c4bca6',
  pond: '#c8d6de',
  pondFlower: '#f0dcd4',
  waterTop: '#9ab4c4',
  rockTop: '#e4dcc8',
  mossTop: '#f0e8d2',
  forestTop: '#d4dcb8',
  tileSide: '#3e3a2e',
  riverTop: '#a8c0d0',
  riverEmissive: '#2a2e34',
  villageWall: '#f4ead4',
  villageRoof: '#b0784a',
  villageTop: '#f0e4cc',
  sceneSky: '#faf4e4',
  sceneGround: '#3a362e',
  sceneIntensity: 1.28,
};

const PALETTE_STARRY: Palette = {
  ...PALETTE_SNOW,
  treeTrunk: '#5b5b72',
  treeCrown1: '#7886c8',
  treeCrown2: '#6876b8',
  treeCrown3: '#5967a8',
  treeCrown4: '#4c5a98',
  fern1: '#5f6fa0',
  fern2: '#7182b4',
  rock1: '#4b5670',
  rock2: '#65718c',
  pond: '#6f86c9',
  pondFlower: '#d8c8ff',
  waterTop: '#7f9fe8',
  rockTop: '#7f8bb0',
  mossTop: '#6474a4',
  forestTop: '#5c6ba0',
  tileSide: '#1a2438',
  riverTop: '#7f9fe8',
  riverEmissive: '#101c3a',
  villageWall: '#c8c2d8',
  villageRoof: '#7a5a7a',
  villageTop: '#a8b0d0',
  sceneSky: '#b9c6ff',
  sceneGround: '#0a1020',
  sceneIntensity: 1.15,
};

const PALETTE_COAST: Palette = {
  ...PALETTE_RAIN,
  treeTrunk: '#7a6a4e',
  treeCrown1: '#4fa89a',
  treeCrown2: '#5fb8a8',
  treeCrown3: '#6fc8b6',
  treeCrown4: '#80d6c4',
  fern1: '#5bb8a8',
  fern2: '#70c8b8',
  rock1: '#7a8f8a',
  rock2: '#94a8a0',
  pond: '#7fd8c8',
  pondFlower: '#ffe1b8',
  waterTop: '#6fd8d0',
  rockTop: '#9ab8b0',
  mossTop: '#70c8b8',
  forestTop: '#5fc0b0',
  tileSide: '#1e3e3c',
  riverTop: '#48c8d8',
  riverEmissive: '#0a3038',
  villageWall: '#e8dcc0',
  villageRoof: '#b86a4a',
  villageTop: '#9ab8a8',
  sceneSky: '#d8f4f0',
  sceneGround: '#0d2828',
  sceneIntensity: 1.35,
};

const PALETTE_DAWN: Palette = {
  ...PALETTE_CLOUD,
  treeTrunk: '#8a6e52',
  treeCrown1: '#a8c888',
  treeCrown2: '#b8d698',
  treeCrown3: '#c8e2a8',
  treeCrown4: '#d8ecb8',
  fern1: '#b8d498',
  fern2: '#c8e0a8',
  rock1: '#a89078',
  rock2: '#c0a88a',
  pond: '#a8c8d8',
  pondFlower: '#ffd8c0',
  waterTop: '#9ac8d8',
  rockTop: '#d8c8a8',
  mossTop: '#c8e0a8',
  forestTop: '#b8d698',
  tileSide: '#3e3428',
  riverTop: '#9ac8d8',
  riverEmissive: '#2a2c2c',
  villageWall: '#f4e0c0',
  villageRoof: '#b8784a',
  villageTop: '#d8c8a8',
  sceneSky: '#ffe0b8',
  sceneGround: '#3a2e22',
  sceneIntensity: 1.4,
};

const PALETTE_SUMMER: Palette = {
  ...PALETTE_RAIN,
  treeCrown1: '#6fc45a',
  treeCrown2: '#7ed468',
  treeCrown3: '#8ee478',
  treeCrown4: '#a0f088',
  fern1: '#78d060',
  fern2: '#8ee078',
  rock1: '#7a9a6a',
  rock2: '#96b080',
  pond: '#7fe06a',
  pondFlower: '#fff0a8',
  waterTop: '#5fd8b8',
  rockTop: '#9ab87a',
  mossTop: '#8ee078',
  forestTop: '#7ed068',
  tileSide: '#2a4a28',
  riverTop: '#48d8c8',
  riverEmissive: '#0a3028',
  villageWall: '#f4e8c8',
  villageRoof: '#d87a4a',
  villageTop: '#b8c890',
  sceneSky: '#fff0b8',
  sceneGround: '#1a2e1a',
  sceneIntensity: 1.45,
};

const PALETTE_POOL: Palette = {
  ...PALETTE_RAIN,
  treeTrunk: '#8a7a5e',
  treeCrown1: '#5fc8a0',
  treeCrown2: '#6fd8b0',
  treeCrown3: '#80e8c0',
  treeCrown4: '#90f0d0',
  fern1: '#60d0b0',
  fern2: '#78e0c0',
  rock1: '#b8b0a0',
  rock2: '#d0c8b8',
  pond: '#5fe0e0',
  pondFlower: '#fff0c0',
  waterTop: '#5fe0e0',
  rockTop: '#e0d8c8',
  mossTop: '#80e8c0',
  forestTop: '#6fd8b0',
  tileSide: '#2a4a48',
  riverTop: '#48d8e8',
  riverEmissive: '#0a3038',
  villageWall: '#f8f0dc',
  villageRoof: '#c87a5a',
  villageTop: '#d8f0e0',
  sceneSky: '#e0ffff',
  sceneGround: '#103030',
  sceneIntensity: 1.5,
};

const PALETTE_WHEAT: Palette = {
  ...PALETTE_CLOUD,
  treeTrunk: '#8a6a3e',
  treeCrown1: '#e8c060',
  treeCrown2: '#f0cc70',
  treeCrown3: '#f8d880',
  treeCrown4: '#ffe490',
  fern1: '#d8c070',
  fern2: '#e8d080',
  rock1: '#b8a070',
  rock2: '#d0b888',
  pond: '#c8d0a0',
  pondFlower: '#fff0c0',
  waterTop: '#8ab8c8',
  rockTop: '#e8d0a0',
  mossTop: '#e8d080',
  forestTop: '#d8c060',
  tileSide: '#4a3a20',
  riverTop: '#a8c8d0',
  riverEmissive: '#302a20',
  villageWall: '#f8e8c8',
  villageRoof: '#b8784a',
  villageTop: '#e8d8b0',
  sceneSky: '#ffe4a8',
  sceneGround: '#3a2e18',
  sceneIntensity: 1.4,
};

const SCENE_PALETTES: Record<StudyRoomScene, Palette> = {
  rain: PALETTE_RAIN,
  snow: PALETTE_SNOW,
  cloud: PALETTE_CLOUD,
  starry: PALETTE_STARRY,
  coast: PALETTE_COAST,
  dawn: PALETTE_DAWN,
  summer: PALETTE_SUMMER,
  pool: PALETTE_POOL,
  wheat: PALETTE_WHEAT,
};

function paletteForScene(scene: SceneType): Palette {
  return SCENE_PALETTES[scene] ?? PALETTE_RAIN;
}

// ── 地块生成 ──
// 先在椭圆内铺满网格，再挖掉显式指定的几片空洞，
// 最后做连通性过滤 —— 结果 = 一整块连着、内部有空缺的岛。

/** 椭圆内的完整网格（未挖洞）。 */
const gridTilesRaw: Array<{ x: number; z: number }> = [];
for (let z = GRID_Z.min; z <= GRID_Z.max; z += 1) {
  for (let x = GRID_X.min; x <= GRID_X.max; x += 1) {
    const ex = x / (GRID_X.max + 1);
    const ez = z / (GRID_Z.max + 1);
    if (ex * ex + ez * ez > 1.05) continue;
    gridTilesRaw.push({ x, z });
  }
}

// ── Mulberry32 种子随机 ──
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildShuffledUnlockOrder(tiles: Array<{ x: number; z: number }>): Map<string, number> {
  const rng = mulberry32(20260804);
  const shuffled = [...tiles];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = tmp;
  }
  const map = new Map<string, number>();
  shuffled.forEach((t, i) => map.set(`${t.x},${t.z}`, i + 1));
  return map;
}

function noise2D(x: number, z: number, seed: number): number {
  return Math.sin(x * 0.37 + seed) * Math.cos(z * 0.41 + seed * 1.3);
}

function isOnRiver(x: number, z: number): boolean {
  const riverCenter =
    Math.sin(x * 0.22) * 3.5 + Math.sin(x * 0.13 + 1.5) * 2 + Math.cos(x * 0.08) * 1.5;
  return Math.abs(z - riverCenter) < 0.85;
}

/** 河道格集合（从完整网格算出，供地形分型与树槽位排除使用）。 */
const riverCells = new Set<string>();
for (const { x, z } of gridTilesRaw) {
  if (isOnRiver(x, z)) riverCells.add(`${x},${z}`);
}

const villageCoords: Array<[number, number]> = [
  [-3, -1],
  [-2, -2],
  [-1, -1],
  [4, 1],
  [5, 0],
  [4, 2],
];
const villageCells = new Set(villageCoords.map(([x, z]) => `${x},${z}`));

const waterfallCoords: Array<[number, number]> = [
  [-5, -1],
  [1, 2],
  [7, -2],
];
const waterfallCells = new Set(waterfallCoords.map(([x, z]) => `${x},${z}`));

const villageClearing = new Set<string>();
for (const [vx, vz] of villageCoords) {
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      villageClearing.add(`${vx + dx},${vz + dz}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 岛内空洞 + 最终地块（必须在 riverCells / villageClearing / waterfallCells 之后）
// ─────────────────────────────────────────────────────────────

/**
 * 岛内的成片空洞：显式指定位置的椭圆洞。
 *
 * 为什么不用噪声挖：实测噪声挖洞会在"要么挖不出内部空洞、要么把岛挖小一半"
 * 之间反复横跳 —— 低频噪声的缺口天然连着岛边，一挖就把岛削小；
 * 高频噪声又只会打碎成马赛克。参考图那种"整体连成一片 + 中间几块成片空缺"
 * 的形态，直接指定洞的位置最可靠。
 *
 * 坐标是网格坐标（x ∈ [-12,12]，z ∈ [-8,8]），rx/rz 是椭圆半径。
 */
const HOLLOW_HOLES: Array<{ cx: number; cz: number; rx: number; rz: number }> = [
  // 实测：挖掉约 90 块（24%），岛边缘仍保留 ~89%，整体完全连通。
  // 5 处洞分散在左内/中上/右侧/下方/右下，斜视角下能清楚看到成片空缺。
  { cx: -6.0, cz: -2.5, rx: 3.5, rz: 2.5 },
  { cx: 2.5, cz: -3.5, rx: 3.0, rz: 2.3 },
  { cx: 6.5, cz: 2.5, rx: 2.6, rz: 2.3 },
  { cx: -2.0, cz: 4.0, rx: 2.8, rz: 2.0 },
  { cx: 9.5, cz: -1.5, rx: 2.3, rz: 2.1 },
];

/** 该格是否落在某个空洞内。 */
function isInHollowHole(x: number, z: number): boolean {
  for (const h of HOLLOW_HOLES) {
    const dx = (x - h.cx) / h.rx;
    const dz = (z - h.cz) / h.rz;
    // 加一点噪声扰动，洞的边缘不会是个数学椭圆，看起来自然些
    const wobble = noise2D(x * 0.9, z * 0.9, 71) * 0.16;
    if (dx * dx + dz * dz < 1 + wobble) return true;
  }
  return false;
}

/**
 * 必须保留、不允许被挖空的地标格（河道 / 村庄 / 瀑布），否则地形会读不出来。
 */
function isPreservedCell(x: number, z: number): boolean {
  const key = `${x},${z}`;
  return riverCells.has(key) || villageClearing.has(key) || waterfallCells.has(key);
}

/**
 * 只保留从岛心连通的那一块，把被洞隔离出去的零星方块丢掉。
 *
 * 关键：BFS **只在保留格之间走**，绝不穿过空洞 ——
 * 否则空洞会被当成"能走通"而保留下来，洞就白挖了。
 */
function keepConnectedFromCenter(keep: Set<string>): Set<string> {
  let start: string | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const key of keep) {
    const [x, z] = key.split(',').map(Number) as [number, number];
    const d = Math.hypot(x, z);
    if (d < bestDist) {
      bestDist = d;
      start = key;
    }
  }
  if (!start) return new Set();

  const kept = new Set<string>([start]);
  const queue: string[] = [start];
  while (queue.length) {
    const cur = queue.pop()!;
    const [x, z] = cur.split(',').map(Number) as [number, number];
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nk = `${x + dx},${z + dz}`;
      if (keep.has(nk) && !kept.has(nk)) {
        kept.add(nk);
        queue.push(nk);
      }
    }
  }
  return kept;
}

/** 最终地块：完整网格 - 显式空洞，并保证主体连通成一整块。 */
const allTilesRaw: Array<{ x: number; z: number }> = (() => {
  const candidate = new Set<string>();
  for (const { x, z } of gridTilesRaw) {
    if (isPreservedCell(x, z) || !isInHollowHole(x, z)) {
      candidate.add(`${x},${z}`);
    }
  }
  const kept = keepConnectedFromCenter(candidate);
  return gridTilesRaw.filter(({ x, z }) => kept.has(`${x},${z}`));
})();

const unlockOrderMap = buildShuffledUnlockOrder(allTilesRaw);

/**
 * 每次打卡长几棵树。
 * 必须保持为 1：一次来访 = 一棵树 = 脚下唯一一圈金环，
 * 这样"今天来过了"的指向是明确的，不会出现点一下亮好几棵树的情况。
 * 岛的茂盛度另由地面蕨类（随天数逐步长出）来体现，见 tick()。
 */
const TREES_PER_CHECKIN = 1;

// ─────────────────────────────────────────────────────────────
// 群岛分割：把岛切成若干独立浮空的小块（参考原项目的"分割"观感）
// 注意：这些常量必须定义在 `tiles` 生成之前，否则 clusterIndexFor
// 在 tiles.map 里被调用会触发 TDZ（Cannot access before initialization）。
// ─────────────────────────────────────────────────────────────

/**
 * 簇的种子点（Voronoi 分区）。
 * 刻意用不等距、带抖动的分布，分出来的块大小不一，比均匀切更像自然碎岛。
 */
const CLUSTER_SEEDS: Array<[number, number]> = [
  [-0.62, -0.1],
  [-0.2, 0.52],
  [0.06, -0.34],
  [0.42, 0.36],
  [0.66, -0.16],
  [-0.1, -0.66],
];

/** 按 Voronoi 把每个格子分到最近的种子。 */
function clusterIndexFor(x: number, z: number): number {
  const ex = x / (GRID_X.max + 1);
  const ez = z / (GRID_Z.max + 1);
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < CLUSTER_SEEDS.length; i += 1) {
    const seed = CLUSTER_SEEDS[i]!;
    const d = Math.hypot(ex - seed[0], ez - seed[1]);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * 成长树槽位：每打卡一天长一棵树，代表这一天的足迹。
 *
 * 关键点（"每日记录更明显"）：槽位按【簇轮转】排列，
 * 即第 1 天种在簇 0、第 2 天种在簇 1 …… 第 7 天回到簇 0。
 * 配合岛的"分割"效果，一眼就能看出每多一天，是哪一块碎岛上多了一棵树。
 * 簇内位置仍打散，避免同簇的树挤成一坨。
 */
const GROWTH_TREE_SLOTS: Array<{ x: number; z: number }> = (() => {
  const rng = mulberry32(77123);

  const buckets: Array<Array<{ x: number; z: number; rnd: number }>> = CLUSTER_SEEDS.map(
    () => [],
  );
  for (const { x, z } of allTilesRaw) {
    const ex = x / (GRID_X.max + 1);
    const ez = z / (GRID_Z.max + 1);
    const dist = Math.hypot(ex, ez);
    // 排除水域/河流，避免树长在水上；留出边缘
    if (dist >= 0.94 || riverCells.has(`${x},${z}`)) continue;
    const id = clusterIndexFor(x, z);
    buckets[id]!.push({ x, z, rnd: rng() });
  }
  buckets.forEach((b) => b.sort((p, q) => p.rnd - q.rnd));

  // 轮转取样：簇0[0], 簇1[0], ..., 簇5[0], 簇0[1], ...
  const ordered: Array<{ x: number; z: number }> = [];
  const maxLen = Math.max(...buckets.map((b) => b.length), 0);
  for (let i = 0; i < maxLen; i += 1) {
    for (let id = 0; id < buckets.length; id += 1) {
      const item = buckets[id]![i];
      if (item) ordered.push({ x: item.x, z: item.z });
    }
  }
  return ordered;
})();

/** 最大可容纳的成长树数量（约等于可打卡天数上限）。 */
const MAX_GROWTH_TREES = GROWTH_TREE_SLOTS.length;

function cellKind(key: string, x: number, z: number): TileKind {
  if (waterfallCells.has(key)) return 'waterfall';
  if (riverCells.has(key)) return 'river';
  if (villageCells.has(key)) return 'village';
  if (villageClearing.has(key)) return 'moss';
  const h = (x * 17 + z * 31 + 100) % 101;
  if (h < 6) return 'water';
  if (h < 18) return 'rock';
  if (h < 38) return 'moss';
  return 'forest';
}

const tiles: Tile[] = allTilesRaw.map(({ x, z }) => {
  const key = `${x},${z}`;
  const kind = cellKind(key, x, z);

  const ex = x / (GRID_X.max + 1);
  const ez = z / (GRID_Z.max + 1);
  const distFromCenter = Math.hypot(ex, ez);

  const centerPeak = Math.max(0, 1 - distFromCenter) * 1.6;
  const centerRamp = Math.max(0, 1 - distFromCenter * 0.7) * 0.8;

  const n1 = noise2D(x, z, 0) * 0.4;
  const n2 = noise2D(x, z, 5) * 0.35;
  const n3 = Math.sin(x * 0.25 + z * 0.3) * Math.cos(z * 0.2 - x * 0.15) * 0.5;
  const n4 = Math.abs(noise2D(x, z, 10)) * 0.4;

  const floatChance =
    Math.abs(Math.sin(x * 0.7 + z * 0.9 + 2)) * Math.abs(Math.cos(z * 0.6 + x * 0.8));
  const isFloating = floatChance > 0.72 && distFromCenter < 0.6;
  const floatBoost = isFloating ? 0.4 + Math.abs(noise2D(x, z, 15)) * 0.6 : 0;

  let rawElevation =
    centerPeak + centerRamp * 0.5 + n1 + n2 + n3 * 0.4 + n4 * 0.3 + floatBoost - distFromCenter * 0.3;

  if (villageClearing.has(key)) {
    rawElevation = 0.15;
  } else if (villageCoords.some(([vx, vz]) => Math.abs(x - vx) <= 2 && Math.abs(z - vz) <= 2)) {
    rawElevation = rawElevation * 0.35 + 0.1;
  }

  const elevation =
    kind === 'water'
      ? rawElevation - 0.6
      : kind === 'river' || kind === 'waterfall'
        ? rawElevation - 0.35
        : Math.round(rawElevation * 100) / 100;

  const baseHeight =
    0.2 + Math.abs((x * 13 + z * 19 + 60) % 7) * 0.07 + (1 - distFromCenter) * 0.3;
  const height = isFloating ? baseHeight + 0.15 : baseHeight;

  const delay = 0.02 + distFromCenter * 0.05;

  // ── 浮动参数：每一块都浮动，幅度/相位各自不同 ──
  // 原先只有 elevation > 0.6 的高地才浮动，导致大片方块看着是"钉死"的。
  // 现在按"离岛心越远浮动越大"给幅度，再叠加噪声做差异，
  // 相位用坐标哈希打散，整岛不会同步上下起伏。
  const driftAmp = 0.045 + distFromCenter * 0.075 + Math.abs(noise2D(x, z, 33)) * 0.03;
  const driftPhase = (x * 0.83 + z * 1.27 + noise2D(x, z, 91) * 2.4) % (Math.PI * 2);

  return {
    x,
    z,
    height,
    elevation,
    delay,
    kind,
    unlockOrder: unlockOrderMap.get(key) ?? 999,
    floatAmp: driftAmp,
    floatPhase: driftPhase,
    cluster: clusterIndexFor(x, z),
  };
});

// ─────────────────────────────────────────────────────────────
// 群岛分割（运行时部分）：依赖 allTilesRaw，必须在它之后定义
// ─────────────────────────────────────────────────────────────

interface ClusterInfo {
  id: number;
  /** 该簇所有格子的归一化中心（用于整簇错位/浮动）。 */
  centerX: number;
  centerZ: number;
  /** 整簇的浮空高度偏移与旋转，让各块分离得更明显。 */
  lift: number;
  yaw: number;
  /** 整簇沿"离岛心方向"向外的水平推开量，制造块与块之间的真实缝隙。 */
  pushX: number;
  pushZ: number;
}

/** 每个格子的簇 id。 */
const clusterOfTile = new Map<string, number>();
for (const { x, z } of allTilesRaw) {
  clusterOfTile.set(`${x},${z}`, clusterIndexFor(x, z));
}

/**
 * 每簇的变换参数：
 *  - lift：整簇上下错开，制造"各自浮空"的层次
 *  - yaw：整簇轻微旋转，边缘不会对齐成网格
 * 用簇 id 做确定性哈希，保证每次渲染一致。
 */
const CLUSTERS: ClusterInfo[] = (() => {
  const acc = CLUSTER_SEEDS.map(() => ({ sx: 0, sz: 0, n: 0 }));
  for (const { x, z } of allTilesRaw) {
    const id = clusterOfTile.get(`${x},${z}`) ?? 0;
    const a = acc[id]!;
    a.sx += x;
    a.sz += z;
    a.n += 1;
  }
  return CLUSTER_SEEDS.map((_, id) => {
    const a = acc[id]!;
    const rand = mulberry32(9001 + id * 137);
    const r1 = rand();
    const r2 = rand();

    const cx = a.n ? a.sx / a.n : 0;
    const cz = a.n ? a.sz / a.n : 0;

    return {
      id,
      centerX: cx,
      centerZ: cz,
      // 只保留很小的落差（±0.05），制造层次但不把岛撕开
      lift: (r1 - 0.5) * 0.1,
      // 极轻微自转（±0.03 rad），让边缘不那么整齐
      yaw: (r2 - 0.5) * 0.06,
      // 关键：不做水平外推。岛必须是一整块连着的，
      // 空灵感靠"镂空"在岛内部挖洞来实现，而不是把岛切成几块推开。
      pushX: 0,
      pushZ: 0,
    };
  });
})();

// ─────────────────────────────────────────────────────────────
// three.js 原生运行时
// ─────────────────────────────────────────────────────────────

/** 按类型 key 复用材质 / 几何体，避免每个地块新建重复 GPU 资源。 */
interface Bank {
  std: Map<string, THREE.MeshStandardMaterial>;
  basic: Map<string, THREE.MeshBasicMaterial>;
  geos: Map<string, THREE.BufferGeometry>;
}

interface CrownRef {
  group: THREE.Group;
  variant: number;
}

interface TileVisual {
  tile: Tile;
  group: THREE.Group;
  baseY: number;
  sparkle: THREE.Group;
  marker: THREE.Group;
  growthTree: THREE.Group;
  growthRing: THREE.Group;
  deco: THREE.Group | null;
  undergrowth: THREE.Group | null;
  undergrowthTall: THREE.Group | null;
}

const containerRef = ref<HTMLElement | null>(null);
const unavailable = ref(false);

let scene: THREE.Scene | null = null;
let camera: THREE.OrthographicCamera | null = null;
let renderer: THREE.WebGLRenderer | null = null;
let controls: OrbitControls | null = null;
let island: THREE.Group | null = null;
let hemi: THREE.HemisphereLight | null = null;
let shadowPlane: THREE.Mesh | null = null;
let softShadowTexture: THREE.CanvasTexture | null = null;

let bank: Bank | null = null;
const tileVisuals: TileVisual[] = [];
const crowns: CrownRef[] = [];
/** 每个簇对应的 Group（用于整簇浮动/倾斜）。 */
let clusterGroups: THREE.Group[] = [];

let clock = new THREE.Clock();
let rafId = 0;
let resizeObserver: ResizeObserver | null = null;
let reducedMotionQuery: MediaQueryList | null = null;
let reducedMotion = false;

function stdMat(key: string, make: () => THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const b = bank!;
  let m = b.std.get(key);
  if (!m) {
    m = make();
    b.std.set(key, m);
  }
  return m;
}

function basicMat(key: string, make: () => THREE.MeshBasicMaterial): THREE.MeshBasicMaterial {
  const b = bank!;
  let m = b.basic.get(key);
  if (!m) {
    m = make();
    b.basic.set(key, m);
  }
  return m;
}

function geom(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  const b = bank!;
  let g = b.geos.get(key);
  if (!g) {
    g = make();
    b.geos.set(key, g);
  }
  return g;
}

// ── 装饰构建 ──

function buildTree(p: Palette, variant: number): THREE.Group {
  const s = variant % 3 === 0 ? 1.05 : 0.82;
  const g = new THREE.Group();
  g.scale.setScalar(s);

  const trunk = new THREE.Mesh(
    geom('cyl:trunk', () => new THREE.CylinderGeometry(0.03, 0.05, 0.4, 5)),
    stdMat('tree:trunk', () => new THREE.MeshStandardMaterial({ color: p.treeTrunk, roughness: 1 })),
  );
  trunk.position.y = 0.2;
  trunk.castShadow = true;
  g.add(trunk);

  const crown = new THREE.Group();
  crown.position.y = 0.4;

  const addCrown = (
    key: string,
    color: string,
    radius: number,
    pos: [number, number, number],
    roughness: number,
  ) => {
    const mesh = new THREE.Mesh(
      geom(`ico:${radius}`, () => new THREE.IcosahedronGeometry(radius, 0)),
      stdMat(key, () => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness })),
    );
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.castShadow = true;
    crown.add(mesh);
  };
  addCrown('tree:c1', p.treeCrown1, 0.18, [0, 0.04, 0], 0.94);
  addCrown('tree:c2', p.treeCrown2, 0.14, [-0.12, -0.01, 0.02], 0.92);
  addCrown('tree:c3', p.treeCrown3, 0.13, [0.12, 0, -0.02], 0.92);
  addCrown('tree:c4', p.treeCrown4, 0.12, [0.03, 0.18, 0.01], 0.9);

  g.add(crown);
  crowns.push({ group: crown, variant });
  return g;
}

function buildRock(p: Palette, variant: number): THREE.Group {
  const g = new THREE.Group();
  g.rotation.y = variant * 0.8;

  const rock1 = new THREE.Mesh(
    geom('dodeca:0.13', () => new THREE.DodecahedronGeometry(0.13, 0)),
    stdMat('rock:1', () =>
      new THREE.MeshStandardMaterial({ color: p.rock1, flatShading: true, roughness: 1 }),
    ),
  );
  rock1.position.y = 0.08;
  rock1.scale.set(1, 0.72, 0.82);
  rock1.castShadow = true;
  g.add(rock1);

  const rock2 = new THREE.Mesh(
    geom('dodeca:0.1', () => new THREE.DodecahedronGeometry(0.1, 0)),
    stdMat('rock:2', () =>
      new THREE.MeshStandardMaterial({ color: p.rock2, flatShading: true, roughness: 1 }),
    ),
  );
  rock2.position.set(0.08, 0.04, 0.05);
  rock2.scale.setScalar(0.55);
  rock2.castShadow = true;
  g.add(rock2);

  return g;
}

function buildFern(p: Palette, variant: number): THREE.Group {
  const g = new THREE.Group();
  g.rotation.y = variant * 0.65;

  const leafGeo = geom('cone:fern', () => new THREE.ConeGeometry(0.032, 0.17, 4));
  const mat1 = stdMat('fern:1', () =>
    new THREE.MeshStandardMaterial({ color: p.fern1, flatShading: true, roughness: 1 }),
  );
  const mat2 = stdMat('fern:2', () =>
    new THREE.MeshStandardMaterial({ color: p.fern2, flatShading: true, roughness: 1 }),
  );

  for (let leaf = 0; leaf < 5; leaf += 1) {
    const mesh = new THREE.Mesh(leafGeo, leaf % 2 ? mat1 : mat2);
    mesh.position.set(Math.cos(leaf * 1.26) * 0.06, 0.06, Math.sin(leaf * 1.26) * 0.06);
    mesh.rotation.set(0.35, -leaf * 1.26, 0.65);
    mesh.castShadow = true;
    g.add(mesh);
  }
  return g;
}

function buildHouse(p: Palette): THREE.Group {
  const g = new THREE.Group();
  const woodMat = stdMat('house:wood', () =>
    new THREE.MeshStandardMaterial({ color: p.treeTrunk, roughness: 0.9 }),
  );

  const wall = new THREE.Mesh(
    geom('box:0.18:0.2:0.15', () => new THREE.BoxGeometry(0.18, 0.2, 0.15)),
    stdMat('house:wall', () =>
      new THREE.MeshStandardMaterial({ color: p.villageWall, roughness: 0.85 }),
    ),
  );
  wall.position.y = 0.1;
  wall.castShadow = true;
  g.add(wall);

  const stripGeo = geom('box:0.19:0.02:0.01', () => new THREE.BoxGeometry(0.19, 0.02, 0.01));
  for (const y of [0.04, 0.1, 0.16]) {
    const strip = new THREE.Mesh(stripGeo, woodMat);
    strip.position.set(0, y, 0.08);
    g.add(strip);
  }

  const roof = new THREE.Mesh(
    geom('cone:roof', () => new THREE.ConeGeometry(0.15, 0.12, 4)),
    stdMat('house:roof', () =>
      new THREE.MeshStandardMaterial({ color: p.villageRoof, flatShading: true, roughness: 0.95 }),
    ),
  );
  roof.position.y = 0.23;
  roof.castShadow = true;
  g.add(roof);

  const windowMesh = new THREE.Mesh(
    geom('box:0.03:0.04:0.01', () => new THREE.BoxGeometry(0.03, 0.04, 0.01)),
    basicMat('house:window', () => new THREE.MeshBasicMaterial({ color: '#fdf6e3' })),
  );
  windowMesh.position.set(0.06, 0.12, 0.08);
  g.add(windowMesh);

  const door = new THREE.Mesh(
    geom('box:0.035:0.08:0.01', () => new THREE.BoxGeometry(0.035, 0.08, 0.01)),
    stdMat('house:door', () =>
      new THREE.MeshStandardMaterial({ color: p.treeTrunk, roughness: 0.8 }),
    ),
  );
  door.position.set(-0.04, 0.06, 0.08);
  g.add(door);

  const chimney = new THREE.Mesh(
    geom('box:0.03:0.08:0.03', () => new THREE.BoxGeometry(0.03, 0.08, 0.03)),
    woodMat,
  );
  chimney.position.set(0.05, 0.28, -0.02);
  g.add(chimney);

  return g;
}

function buildWaterfall(p: Palette): THREE.Group {
  const g = new THREE.Group();

  const stream = new THREE.Mesh(
    geom('cyl:stream', () => new THREE.CylinderGeometry(0.04, 0.06, 0.35, 8)),
    stdMat('wf:stream', () =>
      new THREE.MeshStandardMaterial({
        color: p.riverTop,
        roughness: 0.1,
        emissive: p.riverEmissive,
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: 0.75,
      }),
    ),
  );
  stream.position.y = -0.12;
  g.add(stream);

  const splash1 = new THREE.Mesh(
    geom('sphere:0.07:6:4', () => new THREE.SphereGeometry(0.07, 6, 4)),
    basicMat('wf:splash1', () =>
      new THREE.MeshBasicMaterial({ color: p.waterTop, transparent: true, opacity: 0.25 }),
    ),
  );
  splash1.position.set(0.03, -0.26, 0.02);
  g.add(splash1);

  const splash2 = new THREE.Mesh(
    geom('sphere:0.05:5:3', () => new THREE.SphereGeometry(0.05, 5, 3)),
    basicMat('wf:splash2', () =>
      new THREE.MeshBasicMaterial({ color: p.waterTop, transparent: true, opacity: 0.2 }),
    ),
  );
  splash2.position.set(-0.04, -0.28, -0.01);
  g.add(splash2);

  const pool = new THREE.Mesh(
    geom('circle:0.1:8', () => new THREE.CircleGeometry(0.1, 8)),
    stdMat('wf:pool', () =>
      new THREE.MeshStandardMaterial({
        color: p.riverTop,
        roughness: 0.15,
        emissive: p.riverEmissive,
        emissiveIntensity: 0.3,
        transparent: true,
        opacity: 0.8,
      }),
    ),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.02;
  g.add(pool);

  return g;
}

function buildRiver(p: Palette): THREE.Group {
  const g = new THREE.Group();

  const surface = new THREE.Mesh(
    geom('circle:0.13:8', () => new THREE.CircleGeometry(0.13, 8)),
    stdMat('river:top', () =>
      new THREE.MeshStandardMaterial({
        color: p.riverTop,
        roughness: 0.15,
        emissive: p.riverEmissive,
        emissiveIntensity: 0.4,
        transparent: true,
        opacity: 0.9,
      }),
    ),
  );
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = 0.01;
  g.add(surface);

  const ripple = new THREE.Mesh(
    geom('ring:0.05:0.07:16', () => new THREE.RingGeometry(0.05, 0.07, 16)),
    basicMat('river:ripple', () =>
      new THREE.MeshBasicMaterial({
        color: p.waterTop,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
      }),
    ),
  );
  ripple.rotation.x = -Math.PI / 2;
  ripple.position.set(0.04, 0.02, 0.02);
  g.add(ripple);

  return g;
}

function buildPond(p: Palette, variant: number): THREE.Group {
  const g = new THREE.Group();

  const pond = new THREE.Mesh(
    geom('circle:0.055:6', () => new THREE.CircleGeometry(0.055, 6)),
    stdMat('pond', () => new THREE.MeshStandardMaterial({ color: p.pond, roughness: 0.75 })),
  );
  pond.rotation.x = -Math.PI / 2;
  pond.rotation.z = variant * 0.7;
  pond.position.set(-0.07, 0.02, 0.03);
  g.add(pond);

  if (variant % 2 === 0) {
    const flower = new THREE.Mesh(
      geom('sphere:0.022:6:4', () => new THREE.SphereGeometry(0.022, 6, 4)),
      stdMat('pond:flower', () =>
        new THREE.MeshStandardMaterial({
          color: p.pondFlower,
          emissive: '#7a4058',
          emissiveIntensity: 0.2,
        }),
      ),
    );
    flower.position.set(0.08, 0.03, -0.05);
    g.add(flower);
  }
  return g;
}

/** 成长树：每次打卡长出一棵比普通树更大更亮的树，配金色光环，代表着"这一天来过"。 */
function buildGrowthTree(p: Palette, variant: number): THREE.Group {
  const g = new THREE.Group();
  // 比普通树稍大一点，视觉上能区分但不臃肿
  g.scale.setScalar(1.15);

  const trunk = new THREE.Mesh(
    geom('cyl:growth-trunk', () => new THREE.CylinderGeometry(0.035, 0.06, 0.46, 6)),
    stdMat('growth:trunk', () => new THREE.MeshStandardMaterial({ color: p.treeTrunk, roughness: 1 })),
  );
  trunk.position.y = 0.23;
  trunk.castShadow = true;
  g.add(trunk);

  const crown = new THREE.Group();
  crown.position.y = 0.46;

  const addCrown = (
    key: string,
    color: string,
    radius: number,
    pos: [number, number, number],
  ) => {
    const mesh = new THREE.Mesh(
      geom(`ico:${radius}`, () => new THREE.IcosahedronGeometry(radius, 0)),
      stdMat(key, () => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9 })),
    );
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.castShadow = true;
    crown.add(mesh);
  };
  // 五层树冠，比普通树更饱满
  addCrown('growth:c1', p.treeCrown1, 0.2, [0, 0.02, 0]);
  addCrown('growth:c2', p.treeCrown2, 0.16, [-0.14, -0.02, 0.03]);
  addCrown('growth:c3', p.treeCrown3, 0.15, [0.14, -0.01, -0.02]);
  addCrown('growth:c4', p.treeCrown4, 0.14, [0.02, 0.16, 0.01]);
  addCrown('growth:c5', p.treeCrown1, 0.11, [0, 0.28, 0]);

  g.add(crown);
  crowns.push({ group: crown, variant });
  return g;
}

/**
 * 成长树光环：今天新长出的树脚下的一圈**高亮金色光环**，标识"这一天来过"。
 * 关键点（之前看不见的原因）：
 *  - 用饱和金 #ffd54a 而不是淡黄白 #fff9c4（后者和浅绿地形混在一起）
 *  - AdditiveBlending 叠加发光，toneMapped=false 绕开 ACES 压暗
 *  - 半径放大到 0.30~0.44，跨过一格多一点，远看也能看到
 *  - depthTest=true 但抬到地面上方，避免被地块本身的顶面遮住
 */
function buildGrowthRing(): THREE.Group {
  const g = new THREE.Group();

  // 主环：饱和金，叠加发光
  const ring = new THREE.Mesh(
    geom('ring:growth:0.3:0.44:48', () => new THREE.RingGeometry(0.3, 0.44, 48)),
    basicMat('growth:ring', () =>
      new THREE.MeshBasicMaterial({
        color: '#ffd54a',
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    ),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  g.add(ring);

  // 内圈实心光斑，让"脚下在发光"更明显
  const glow = new THREE.Mesh(
    geom('circle:growth:0.3:32', () => new THREE.CircleGeometry(0.3, 32)),
    basicMat('growth:glow', () =>
      new THREE.MeshBasicMaterial({
        color: '#ffe98a',
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    ),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.05;
  g.add(glow);

  return g;
}

function buildSparkle(color: string): THREE.Group {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    geom('ring:0.14:0.22:32', () => new THREE.RingGeometry(0.14, 0.22, 32)),
    basicMat('sparkle:ring', () =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
    ),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  g.add(ring);

  const centerSmall = new THREE.Mesh(
    geom('sphere:0.04:6:4', () => new THREE.SphereGeometry(0.04, 6, 4)),
    basicMat('sparkle:center', () =>
      new THREE.MeshBasicMaterial({ color: '#fffef0', transparent: true, opacity: 0.9 }),
    ),
  );
  centerSmall.position.y = 0.11;
  g.add(centerSmall);

  const centerBig = new THREE.Mesh(
    geom('sphere:0.08:6:4', () => new THREE.SphereGeometry(0.08, 6, 4)),
    basicMat('sparkle:glow', () =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3 }),
    ),
  );
  centerBig.position.y = 0.1;
  g.add(centerBig);

  const dotMat = basicMat('sparkle:dot', () =>
    new THREE.MeshBasicMaterial({ color: '#fffbe6', transparent: true, opacity: 0.85 }),
  );
  const dotGeo = geom('sphere:0.035:5:3', () => new THREE.SphereGeometry(0.035, 5, 3));
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    const dot = new THREE.Mesh(dotGeo, dotMat);
    dot.position.set(Math.cos(angle) * 0.2, 0.16, Math.sin(angle) * 0.2);
    g.add(dot);
  }

  return g;
}

/** 打卡地标：一根小旗杆 + 主色旗帜，插在"今日新增"地块上，作为来访留下的永久标记。 */
function buildCheckinMarker(): THREE.Group {
  const g = new THREE.Group();

  const pole = new THREE.Mesh(
    geom('cyl:0.016:0.016:0.56:5', () => new THREE.CylinderGeometry(0.016, 0.016, 0.56, 5)),
    stdMat('marker:pole', () =>
      new THREE.MeshStandardMaterial({ color: '#e8e2d2', roughness: 0.7 }),
    ),
  );
  pole.position.y = 0.28;
  pole.castShadow = true;
  g.add(pole);

  const flag = new THREE.Mesh(
    geom('marker:flag', () => new THREE.BoxGeometry(0.24, 0.15, 0.016)),
    stdMat('marker:flag', () =>
      new THREE.MeshStandardMaterial({ color: '#d7ef83', roughness: 0.45, emissive: '#6a7a18', emissiveIntensity: 0.35 }),
    ),
  );
  flag.position.set(0.12, 0.48, 0);
  flag.castShadow = true;
  g.add(flag);

  // 旗顶小圆点，远看更醒目
  const knob = new THREE.Mesh(
    geom('sphere:0.026:6:4', () => new THREE.SphereGeometry(0.026, 6, 4)),
    basicMat('marker:knob', () =>
      new THREE.MeshBasicMaterial({ color: '#fff9c4' }),
    ),
  );
  knob.position.y = 0.57;
  g.add(knob);

  return g;
}

function buildDecoration(tile: Tile, index: number, p: Palette): THREE.Group | null {
  // 只保留「地形特征」装饰（水/河/瀑布/村庄/岩石）。
  // 树和蕨不在这里生成 —— 它们由「成长树」按打卡天数逐步长出，
  // 这样 0 天是光秃地形，打卡越多岛越茂盛。
  switch (tile.kind) {
    case 'rock':
      return buildRock(p, index);
    case 'water':
      return buildPond(p, index);
    case 'river':
      return buildRiver(p);
    case 'waterfall':
      return buildWaterfall(p);
    case 'village':
      return buildHouse(p);
    default:
      return null;
  }
}

function topMaterial(tile: Tile, p: Palette): THREE.MeshStandardMaterial {
  switch (tile.kind) {
    case 'water':
      return stdMat('top:water', () =>
        new THREE.MeshStandardMaterial({
          color: p.waterTop,
          emissive: '#124f4a',
          emissiveIntensity: 0.4,
          roughness: 0.34,
        }),
      );
    case 'river':
    case 'waterfall':
      return stdMat('top:river', () =>
        new THREE.MeshStandardMaterial({
          color: p.riverTop,
          emissive: p.riverEmissive,
          emissiveIntensity: 0.35,
          roughness: 0.9,
        }),
      );
    case 'village':
      return stdMat('top:village', () => new THREE.MeshStandardMaterial({ color: p.villageTop, roughness: 0.9 }));
    case 'rock':
      return stdMat('top:rock', () => new THREE.MeshStandardMaterial({ color: p.rockTop, roughness: 0.9 }));
    case 'moss':
      return stdMat('top:moss', () => new THREE.MeshStandardMaterial({ color: p.mossTop, roughness: 0.9 }));
    case 'forest':
    default:
      return stdMat('top:forest', () =>
        new THREE.MeshStandardMaterial({ color: p.forestTop, roughness: 0.9 }),
      );
  }
}

function buildTile(tile: Tile, index: number, p: Palette): TileVisual {
  const baseY = -tile.height + tile.elevation;
  const group = new THREE.Group();
  group.position.set(tile.x * UNIT, baseY, tile.z * UNIT);
  group.scale.set(0.7, 0.001, 0.7);

  // 每块给一点点绕 Y 的随机旋转，方阵立刻不那么"码整齐"，更接近参考图的碎块感
  const yawHash = Math.abs(Math.sin(tile.x * 12.9898 + tile.z * 78.233)) % 1;
  group.rotation.y = (yawHash - 0.5) * 0.16;

  const tileW = UNIT * 0.92;
  const boxGeo = geom('box:unit', () => new THREE.BoxGeometry(1, 1, 1));
  const sideMat = stdMat('side', () =>
    new THREE.MeshStandardMaterial({ color: p.tileSide, roughness: 0.96 }),
  );

  const side = new THREE.Mesh(boxGeo, sideMat);
  side.scale.set(tileW, tile.height, tileW);
  side.position.y = tile.height / 2;
  side.castShadow = true;
  side.receiveShadow = true;
  group.add(side);

  const top = new THREE.Mesh(boxGeo, topMaterial(tile, p));
  top.scale.set(tileW, 0.04, tileW);
  top.position.y = tile.height + 0.02;
  top.castShadow = true;
  top.receiveShadow = true;
  group.add(top);

  const deco = buildDecoration(tile, index, p);
  if (deco) {
    deco.position.y = tile.height + 0.04;
    group.add(deco);
  }

  const sparkle = buildSparkle('#fff9c4');
  sparkle.position.y = tile.height + 0.22;
  sparkle.visible = false;
  group.add(sparkle);

  // 打卡地标（旗帜）：今日新增地块插入，永久保留至下次打卡日滚动
  const marker = buildCheckinMarker();
  marker.position.y = tile.height + 0.04;
  marker.visible = false;
  group.add(marker);

  // 成长树 + 光环：由打卡累计数控制是否"长出来"（见 tick）
  // 每 4 棵用一棵更饱满的"大树"，其余用普通树，避免整岛完全一样。
  const growthTree = new THREE.Group();
  if (index % 4 === 0) {
    growthTree.add(buildGrowthTree(p, index));
  } else {
    const normal = buildTree(p, index);
    // 与成长树统一尺寸，保证每格看着一致
    normal.scale.setScalar(1.15);
    growthTree.add(normal);
  }
  growthTree.position.y = tile.height + 0.04;
  growthTree.visible = false;
  group.add(growthTree);

  const growthRing = buildGrowthRing();
  growthRing.position.y = tile.height + 0.03;
  growthRing.visible = false;
  group.add(growthRing);

  // 地面植被：分两档随打卡天数逐步长出（不占用「每天一棵树」的名额），
  // 让"岛越久越茂盛"由地表密度体现，而不是靠一次亮起好几棵树。
  let undergrowth: THREE.Group | null = null;
  let undergrowthTall: THREE.Group | null = null;
  if (tile.kind === 'forest' || tile.kind === 'moss') {
    undergrowth = buildFern(p, index);
    undergrowth.position.y = tile.height + 0.03;
    undergrowth.visible = false;
    group.add(undergrowth);

    if (index % 3 === 0) {
      undergrowthTall = buildFern(p, index + 7);
      undergrowthTall.scale.setScalar(1.45);
      undergrowthTall.rotation.y = index * 1.1;
      undergrowthTall.position.y = tile.height + 0.03;
      undergrowthTall.visible = false;
      group.add(undergrowthTall);
    }
  }

  return {
    tile,
    group,
    baseY,
    sparkle,
    marker,
    growthTree,
    growthRing,
    deco,
    undergrowth,
    undergrowthTall,
  };
}

function applyLights(p: Palette): void {
  if (!hemi) return;
  hemi.color.set(p.sceneSky);
  hemi.groundColor.set(p.sceneGround);
  hemi.intensity = p.sceneIntensity;
}

function disposeIsland(): void {
  if (island && scene) {
    scene.remove(island);
    island = null;
  }
  tileVisuals.length = 0;
  crowns.length = 0;
  if (bank) {
    bank.std.forEach((m) => m.dispose());
    bank.basic.forEach((m) => m.dispose());
    bank.geos.forEach((g) => g.dispose());
    bank = null;
  }
}

/** 清空簇 Group 引用（实际由 disposeIsland 移除 island 时一并回收）。 */
function disposeClusterGroups(): void {
  clusterGroups.length = 0;
}

function buildIsland(): void {
  if (!scene) return;
  const p = paletteForScene(props.scene);

  disposeIsland();
  disposeClusterGroups();

  bank = { std: new Map(), basic: new Map(), geos: new Map() };
  island = new THREE.Group();
  island.rotation.y = -0.18;

  // 每簇一个独立 Group：整簇做 push（水平外推）+ lift（上下错开）+ yaw（轻微自转），
  // 于是岛被"切"成若干块各自浮空的碎岛，而不是一整块连续的板。
  clusterGroups = CLUSTERS.map((info) => {
    const g = new THREE.Group();
    g.position.set(info.pushX, info.lift, info.pushZ);
    g.rotation.y = info.yaw;
    island!.add(g);
    return g;
  });

  for (let i = 0; i < tiles.length; i += 1) {
    const tile = tiles[i]!;
    const visual = buildTile(tile, i, p);
    const target = clusterGroups[tile.cluster] ?? island;
    target.add(visual.group);
    tileVisuals.push(visual);
  }

  scene.add(island);
  applyLights(p);
}

function tick(): void {
  rafId = 0;
  if (!scene || !camera || !renderer || !controls || !island || unavailable.value) return;

  const elapsed = clock.getElapsedTime();

  // ── 成长树机制 ──
  // 0 天 = 光秃地形；每打卡一天长出 TREES_PER_CHECKIN 棵树，
  // 打卡越多岛越茂盛；今天新长出的树带金色光环。
  const treeCount = Math.min(
    MAX_GROWTH_TREES,
    (props.totalCheckins ?? 0) * TREES_PER_CHECKIN,
  );
  // 今天新增的那一批树（带光环脉冲，呼应"今天来过"）
  const todayTreeCount = Math.min(
    treeCount,
    Math.max(0, props.todayCheckins ?? 0) * TREES_PER_CHECKIN,
  );
  const todayTreeStart = treeCount - todayTreeCount; // 槽位 0-based 索引

  // ── 每日记录 → 簇的映射 ──
  // 每一簇代表"某一天"，簇内的成长树按天填充：
  // 第 N 天打卡后，第 (N % CLUSTERS.length) 个簇里会长出那一棵树。
  // 于是"哪一天来过"在地图上是分块呈现的 —— 每日记录一眼可辨。
  const dayTotal = props.totalCheckins ?? 0;
  const growthSlotMap = new Map<string, number>();
  for (let i = 0; i < treeCount; i += 1) {
    const slot = GROWTH_TREE_SLOTS[i];
    if (slot) growthSlotMap.set(`${slot.x},${slot.z}`, i);
  }

  if (!reducedMotion) {
    island.position.y = Math.sin(elapsed * 0.55) * 0.025;

    // 各簇轻微呼吸：幅度很小，只让方块阵看起来"活着"，
    // 不会把原本连成一片的岛在视觉上撕开。
    for (let i = 0; i < clusterGroups.length; i += 1) {
      const g = clusterGroups[i]!;
      const info = CLUSTERS[i]!;
      const phase = i * 1.7;
      g.position.set(
        info.pushX,
        info.lift + Math.sin(elapsed * 0.62 + phase) * 0.018,
        info.pushZ,
      );
    }
  }

  for (const visual of tileVisuals) {
    // 地块本身始终可见（完整岛形）
    visual.group.visible = true;

    const raw = reducedMotion
      ? 1
      : THREE.MathUtils.clamp((elapsed - visual.tile.delay) / 0.55, 0, 1);
    const progress = 1 - Math.pow(1 - raw, 3);

    // 每一块都浮动（幅度/相位各不相同），不再只让高地浮动
    const floatBob = reducedMotion
      ? 0
      : Math.sin(elapsed * 0.95 + visual.tile.floatPhase) * visual.tile.floatAmp;

    visual.group.position.y = visual.baseY + floatBob;
    visual.group.scale.set(0.7 + progress * 0.3, Math.max(progress, 0.001), 0.7 + progress * 0.3);

    // 成长树：按槽位序号决定是否已长出（0-based，-1 表示不是槽位）
    const slotIndex = growthSlotMap.get(`${visual.tile.x},${visual.tile.z}`) ?? -1;
    const isGrowthTile = slotIndex >= 0;
    visual.growthTree.visible = isGrowthTile;
    visual.growthRing.visible = false;

    if (isGrowthTile) {
      const isTodayTree = slotIndex >= todayTreeStart;

      // 新长出的树做「破土生长」动画：按槽位顺序依次冒出。
      // 今日那棵额外放大，让它成为全岛视觉焦点（一次打卡只有这一棵带金环）。
      const growRaw = reducedMotion
        ? 1
        : THREE.MathUtils.clamp((elapsed - slotIndex * 0.06) / 0.5, 0, 1);
      const growProgress = 1 - Math.pow(1 - growRaw, 3);
      const baseScale = isTodayTree ? 1.45 : 1.15;
      visual.growthTree.scale.setScalar(Math.max(0.001, growProgress) * baseScale);

      // 今日新增的树：金色光环脉冲
      visual.growthRing.visible = isTodayTree;
      if (isTodayTree) {
        const phase = slotIndex * 0.9;
        visual.growthRing.scale.setScalar(
          reducedMotion ? 1 : 1.15 + Math.sin(elapsed * 2.4 + phase) * 0.2,
        );
        visual.growthRing.position.y =
          visual.tile.height + 0.06 + (reducedMotion ? 0 : Math.sin(elapsed * 2.4 + phase) * 0.02);
      }
    }

    // 有任何装饰（地形或成长树）时，保持原装饰可见；成长树槽位隐藏原小装饰避免重叠
    if (visual.deco) {
      visual.deco.visible = !isGrowthTile;
    }

    // 地面植被：随打卡天数分层长出（是"茂盛度"，不参与今日高亮）
    if (visual.undergrowth) {
      visual.undergrowth.visible = !isGrowthTile && dayTotal >= 2;
    }
    if (visual.undergrowthTall) {
      visual.undergrowthTall.visible = !isGrowthTile && dayTotal >= 6;
    }

    visual.sparkle.visible = false;
    visual.marker.visible = false;
  }

  // ── 每日记录在岛上的分块呈现 ──
  // 成长树槽位按簇轮转排列（见 GROWTH_TREE_SLOTS）：
  // 每多一天打卡，就在"下一块碎岛"上长出一棵树，
  // 因此每天来过没有、落在哪块岛，都直接可辨。

  if (!reducedMotion) {
    for (const crown of crowns) {
      crown.group.rotation.z = Math.sin(elapsed * 0.85 + crown.variant * 0.7) * 0.03;
      crown.group.rotation.x = Math.cos(elapsed * 0.7 + crown.variant) * 0.015;
    }

    // 今日光环：材质在 basicMat 里是共享的，透明度必须在这里统一驱动，
    // 否则逐块设置只会保留最后一次的值（这是之前光环几乎看不见的原因之一）。
    const growthRingMat = bank?.basic.get('growth:ring');
    const growthGlowMat = bank?.basic.get('growth:glow');
    const beat = Math.sin(elapsed * 2.4);
    if (growthRingMat) growthRingMat.opacity = 0.78 + beat * 0.22;
    if (growthGlowMat) growthGlowMat.opacity = 0.22 - beat * 0.14;
  }

  controls.update();
  renderer.render(scene, camera);
  rafId = requestAnimationFrame(tick);
}

function startLoop(): void {
  if (!rafId) rafId = requestAnimationFrame(tick);
}

function makeSoftShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, 'rgba(0,0,0,0.55)');
    gradient.addColorStop(0.55, 'rgba(0,0,0,0.22)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
  }
  return new THREE.CanvasTexture(canvas);
}

function resize(): void {
  const host = containerRef.value;
  if (!host || !camera || !renderer) return;
  const width = Math.max(1, host.clientWidth);
  const height = Math.max(1, host.clientHeight);
  const aspect = width / height;

  // 正交相机必须严格保持「视锥宽高比 == 画布宽高比」，否则画面会被拉伸变扁。
  // 用 contain 思路并留少量边距，让岛屿尽量填满画布且保持正确比例。
  const contentHalfWidth = 4.7; // 岛屿水平半径（世界单位）
  const contentHalfHeight = 3.4; // 岛屿垂直半径（含俯视透视的高度）
  const contentAspect = contentHalfWidth / contentHalfHeight;
  let halfHeight: number;
  if (aspect > contentAspect) {
    // 画布更宽：以高度为准（岛屿撑满纵向），横向按 aspect 扩展
    halfHeight = contentHalfHeight;
  } else {
    // 画布更高/接近正方：以宽度为准，纵向按 aspect 扩展
    halfHeight = contentHalfWidth / aspect;
  }
  const halfWidth = halfHeight * aspect;

  camera.left = -halfWidth;
  camera.right = halfWidth;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function onReducedMotionChange(event: MediaQueryListEvent): void {
  reducedMotion = event.matches;
}

onMounted(() => {
  const host = containerRef.value;
  if (!host) return;

  try {
    reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion = reducedMotionQuery.matches;
    reducedMotionQuery.addEventListener('change', onReducedMotionChange);

    // 每次挂载重开时钟，让生长动画在重挂载时从头播放。
    clock = new THREE.Clock();

    const p = paletteForScene(props.scene);

    scene = new THREE.Scene();

    const ambient = new THREE.AmbientLight(0xffffff, 1.4);
    hemi = new THREE.HemisphereLight(p.sceneSky, p.sceneGround, p.sceneIntensity);
    const dir = new THREE.DirectionalLight('#f0faf0', 2.0);
    dir.position.set(5, 10, 4);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.left = -8;
    dir.shadow.camera.right = 8;
    dir.shadow.camera.top = 8;
    dir.shadow.camera.bottom = -8;
    dir.shadow.bias = -0.0001;
    scene.add(ambient, hemi, dir);

    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 120);
    camera.position.set(8, 8, 9);

    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = 'learning-island-canvas';
    renderer.domElement.setAttribute('aria-hidden', 'true');
    host.append(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.minPolarAngle = Math.PI / 3.2;
    controls.maxPolarAngle = Math.PI / 2.4;
    controls.target.set(0, 0.3, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.update();

    softShadowTexture = makeSoftShadowTexture();
    shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 14),
      new THREE.MeshBasicMaterial({
        map: softShadowTexture,
        color: '#010906',
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = -1.2;
    scene.add(shadowPlane);

    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    buildIsland();
    renderer.render(scene, camera);
    startLoop();
  } catch {
    unavailable.value = true;
  }
});

watch(
  () => props.scene,
  () => {
    if (!scene) return;
    buildIsland();
    if (renderer && camera) renderer.render(scene, camera);
  },
);

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId);
  rafId = 0;
  resizeObserver?.disconnect();
  resizeObserver = null;
  reducedMotionQuery?.removeEventListener('change', onReducedMotionChange);
  reducedMotionQuery = null;
  controls?.dispose();
  controls = null;
  disposeIsland();
  if (shadowPlane) {
    shadowPlane.geometry.dispose();
    (shadowPlane.material as THREE.Material).dispose();
    if (scene) scene.remove(shadowPlane);
    shadowPlane = null;
  }
  softShadowTexture?.dispose();
  softShadowTexture = null;
  if (renderer) {
    renderer.domElement.remove();
    renderer.dispose();
    renderer = null;
  }
  scene = null;
  camera = null;
  hemi = null;
});
</script>

<template>
  <div ref="containerRef" class="learning-island" role="img" aria-label="3D 像素小岛">
    <div v-if="unavailable" class="learning-island-fallback">
      <span aria-hidden="true">✦</span>
      <strong>小岛暂时无法显示</strong>
    </div>
  </div>
</template>

<style scoped>
.learning-island {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 300px;
  overflow: hidden;
  touch-action: none;
  cursor: grab;
}

.learning-island:active {
  cursor: grabbing;
}

.learning-island :deep(.learning-island-canvas) {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
}

/* 「拖动查看」提示已上移到 IslandCheckin 的操作栏统一排布，此处只保留兜底样式 */
.learning-island-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--study-room-primary, #d7ef83);
}

.learning-island-fallback {
  position: absolute;
  z-index: 2;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 8px;
  color: rgb(255 255 255 / 0.5);
  text-align: center;
}

.learning-island-fallback span {
  font-size: 40px;
  color: var(--study-room-primary, #d7ef83);
}

.learning-island-fallback strong {
  color: rgb(255 255 255 / 0.78);
  font-size: 15px;
  font-weight: 600;
}
</style>
