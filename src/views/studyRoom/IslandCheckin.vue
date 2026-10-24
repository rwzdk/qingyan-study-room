<script lang="ts" setup>
import { computed } from 'vue';

import IconifyIcon from '#/components/IconifyIcon.vue';

import LearningIsland from './LearningIsland.vue';
import { getStudyRoomSceneCopy, type StudyRoomScene } from './study-room-scene';
import {
  calcStreak,
  daysOfYear,
  todayKey,
} from './study-room-store';
import { useStudyRoomState, scheduleSaveStudyRoom } from './study-room-state-store';

const props = withDefaults(
  defineProps<{ scene?: StudyRoomScene }>(),
  { scene: 'rain' },
);

const { state } = useStudyRoomState();

// 直接响应式读 state，打卡后立即反映（无需本地副本）
const checkins = computed(() => state.value.checkins ?? []);

// 今日打卡次数（供 3D 小岛标记"今日新增"地块）
const todayCheckins = computed(
  () => checkins.value.filter((item) => item.date === todayKey()).length,
);

const sceneCopy = computed(() => getStudyRoomSceneCopy(props.scene));

/** 已打卡日期集合（YYYY-MM-DD）。 */
const checkedSet = computed(() => new Set(checkins.value.map((item) => item.date)));

const currentYear = new Date().getFullYear();

// ---------- 指标 ----------

/** 持续来访：连续天数（今天未打卡则从昨天起算）。 */
const streak = computed(() => calcStreak(checkedSet.value));

/** 岛龄：历史总打卡次数（一次来访记一天）。 */
const totalCheckins = computed(() => checkins.value.length);

/** 本地时区 YYYY-MM-DD 格式化。 */
function keyOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** 本周（周一为起点）7 天的日期 key 列表。 */
const weekKeys = computed<string[]>(() => {
  const now = new Date();
  const offset = (now.getDay() + 6) % 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
  const keys: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    keys.push(keyOf(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)));
  }
  return keys;
});

/** 本周足迹：本周内的打卡天数（去重）。 */
const weekCount = computed(
  () => weekKeys.value.filter((date) => checkedSet.value.has(date)).length,
);

// ---------- 今日打卡 ----------

const checkedToday = computed(() => checkedSet.value.has(todayKey()));

function checkIn() {
  if (checkedToday.value) return;
  state.value.checkins = [...checkins.value, { date: todayKey(), hours: 1 }];
  scheduleSaveStudyRoom();
}

// ---------- 年度热力图 ----------

interface HeatCell {
  /** YYYY-MM-DD；补齐占位格为 ''。 */
  date: string;
  /** 是否为年初/年末的补齐占位格（透明，不参与染色）。 */
  blank: boolean;
}

interface YearDay {
  date: string;
  dow: number; // 0(周日)-6(周六)
  dayOfMonth: number;
  month: number; // 0-based
}

/** 用本地时区解析，避免 YYYY-MM-DD 被当作 UTC 导致的跨日偏差。 */
function parseKey(date: string): Date {
  const parts = date.split('-').map(Number);
  const year = parts[0] ?? 1970;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  return new Date(year, month - 1, day);
}

const yearDays: YearDay[] = daysOfYear(currentYear).map((date) => {
  const d = parseKey(date);
  return { date, dow: d.getDay(), dayOfMonth: d.getDate(), month: d.getMonth() };
});

const firstDay = yearDays[0];
const firstWeekday = firstDay ? firstDay.dow : 0;

/** 按「周列 × 7 行」排列，年初/年末用 blank 占位补齐，对齐 GitHub 热力图。 */
const columns = computed<HeatCell[][]>(() => {
  const cols: HeatCell[][] = [];
  let current: HeatCell[] = [];
  for (let i = 0; i < firstWeekday; i += 1) {
    current.push({ date: '', blank: true });
  }
  for (const day of yearDays) {
    current.push({ date: day.date, blank: false });
    if (current.length === 7) {
      cols.push(current);
      current = [];
    }
  }
  if (current.length > 0) {
    while (current.length < 7) current.push({ date: '', blank: true });
    cols.push(current);
  }
  return cols;
});

/** 星期标签：只标出 日 / 二 / 四 / 六。 */
const WEEKDAY_LABELS = ['日', '', '二', '', '四', '', '六'];

/** 顶部日期行（对齐原项目：10月17日星期六）。 */
const todayDateLabel = computed(() => {
  const now = new Date();
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
  return `${now.getMonth() + 1}月${now.getDate()}日 星期${weekday}`;
});

const HEAT_CELL_SIZE = 12;
const HEAT_CELL_GAP = 3;
const HEAT_PITCH = HEAT_CELL_SIZE + HEAT_CELL_GAP;

/** 每个「1 号」所在列 + 月份名，用于顶部月份轴。 */
const monthLabels = computed(() => {
  const labels: { label: string; col: number }[] = [];
  yearDays.forEach((day, index) => {
    if (day.dayOfMonth === 1) {
      labels.push({
        label: `${day.month + 1}月`,
        col: Math.floor((index + firstWeekday) / 7),
      });
    }
  });
  return labels;
});

function monthLeft(col: number): string {
  return `${col * HEAT_PITCH}px`;
}

function cellTitle(cell: HeatCell): string {
  if (cell.blank) return '';
  return checkedSet.value.has(cell.date) ? `${cell.date} · 已打卡` : `${cell.date} · 未打卡`;
}
</script>

<template>
  <div class="study-room-extension island-checkin">
    <div class="sr-ext-header island-header">
      <div>
        <p class="island-date">{{ todayDateLabel }}</p>
        <h1>小岛</h1>
      </div>
      <div class="island-metrics">
        <div class="island-metric">
          <span class="island-metric-label">持续来访</span>
          <span class="island-metric-value">{{ streak }}<i>天</i></span>
        </div>
        <div class="island-metric">
          <span class="island-metric-label">岛龄</span>
          <span class="island-metric-value">{{ totalCheckins }}<i>天</i></span>
        </div>
        <div class="island-metric">
          <span class="island-metric-label">本周足迹</span>
          <span class="island-metric-value">{{ weekCount }}<i>天</i></span>
        </div>
      </div>
    </div>

    <div class="island-body">
      <div class="island-scene">
        <LearningIsland
          :total-checkins="totalCheckins"
          :today-checkins="todayCheckins"
          :scene="props.scene"
        />
      </div>

      <!-- 操作栏：左侧「拖动查看」提示，右侧打卡按钮，同一基线对齐，紧贴热力图上方 -->
      <div class="island-actions">
        <span class="island-drag-hint">
          <svg class="island-drag-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M8 1.6v12.8M1.6 8h12.8M8 1.6 6.4 3.2M8 1.6l1.6 1.6M8 14.4l-1.6-1.6M8 14.4l1.6-1.6M1.6 8 3.2 6.4M1.6 8l1.6 1.6M14.4 8l-1.6-1.6M14.4 8l-1.6 1.6"
              fill="none"
              stroke="currentColor"
              stroke-width="1.1"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          拖动查看
        </span>

        <button v-if="!checkedToday" type="button" class="sr-btn" @click="checkIn">
          <IconifyIcon icon="lucide:map-pin" />
          来访{{ sceneCopy.labelShort }}
        </button>
        <div v-else class="sr-checkin-done" role="status">
          <IconifyIcon icon="lucide:circle-check" />
          今天来过了 · 已持续 {{ streak }} 天
        </div>
      </div>

      <section class="sr-panel sr-heatmap-panel">
        <div class="sr-heatmap-head">
          <h2>年度热力图</h2>
          <span class="sr-heatmap-year">{{ currentYear }}</span>
        </div>

        <div class="sr-heatmap-scroll">
          <div class="heatmap-months">
            <span
              v-for="(item, index) in monthLabels"
              :key="index"
              class="heatmap-month"
              :style="{ left: monthLeft(item.col) }"
            >
              {{ item.label }}
            </span>
          </div>

          <div class="heatmap-body">
            <div class="heatmap-weekdays" aria-hidden="true">
              <span v-for="(label, index) in WEEKDAY_LABELS" :key="index">{{ label }}</span>
            </div>

            <div class="heatmap-grid" role="img" aria-label="年度打卡热力图">
              <div v-for="(col, colIndex) in columns" :key="colIndex" class="heatmap-col">
                <div
                  v-for="(cell, rowIndex) in col"
                  :key="rowIndex"
                  class="heatmap-cell"
                  :class="{
                    checked: !cell.blank && checkedSet.has(cell.date),
                    blank: cell.blank,
                  }"
                  :title="cellTitle(cell)"
                />
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.island-checkin {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
}

/* 头部：标题左、指标右（对齐原项目） */
.island-header {
  align-items: flex-start;
}

.island-date {
  margin: 0 0 6px;
  color: rgb(255 255 255 / 0.55);
  font-size: 13px;
  font-weight: 600;
}

.island-header h1 {
  margin: 0;
  color: #fff;
  font-size: 34px;
  font-weight: 800;
  line-height: 1.2;
}

.island-metrics {
  display: flex;
  overflow: hidden;
  border: 1px solid
    color-mix(in srgb, var(--study-room-primary, #d7ef83) 18%, transparent);
  border-radius: 10px;
  background: color-mix(
    in srgb,
    var(--study-room-secondary, #5ab8b0) 9%,
    rgb(0 0 0 / 0.27)
  );
  backdrop-filter: blur(12px);
}

.island-metric {
  display: flex;
  min-width: 96px;
  flex-direction: column;
  gap: 2px;
  padding: 10px 18px;
  border-left: 1px solid rgb(255 255 255 / 0.08);
}

.island-metric:first-child {
  border-left: 0;
}

.island-metric-label {
  color: rgb(255 255 255 / 0.4);
  font-size: 10px;
  white-space: nowrap;
}

.island-metric-value {
  color: #fff;
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.island-metric-value i {
  margin-left: 2px;
  color: rgb(255 255 255 / 0.4);
  font-size: 12px;
  font-style: normal;
  font-weight: 400;
}

/* 主体：3D 场景 + 底部热力图，热力图贴住页面下边界 */
.island-body {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 0;
  margin-top: 8px;
}

/*
 * 3D 画布：吸收剩余高度（父级链上每层都有 min-height:0，不会再把热力图挤出视口）。
 * 保留 min-height 兜底，窗口很矮时才让 .study-room-body 滚动。
 */
.island-scene {
  position: relative;
  flex: 1;
  min-height: 220px;
}

/*
 * 操作栏：左侧「拖动查看」提示 + 右侧打卡按钮，同一行垂直居中。
 * 彻底避免之前两处「拖动查看」叠成重影、以及按钮用 margin-top:-56px
 * 硬压在热力图上的问题。
 */
.island-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 8px;
  margin-bottom: 10px;
}

.island-drag-hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px 6px 10px;
  border: 1px solid rgb(255 255 255 / 0.12);
  border-radius: 999px;
  color: rgb(255 255 255 / 0.52);
  background: rgb(0 0 0 / 0.24);
  font-size: 12px;
  backdrop-filter: blur(8px);
  pointer-events: none;
  user-select: none;
}

.island-drag-icon {
  width: 13px;
  height: 13px;
  color: var(--study-room-primary);
}

.island-scene-glow {
  width: 180px;
  height: 180px;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    color-mix(in srgb, var(--study-room-primary) 22%, transparent) 0%,
    transparent 70%
  );
  filter: blur(10px);
}

.sr-checkin-done {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border: 1px solid color-mix(in srgb, var(--study-room-primary) 42%, transparent);
  border-radius: 999px;
  color: var(--study-room-primary);
  background: rgb(0 0 0 / 0.28);
  font-size: 14px;
  font-weight: 600;
  backdrop-filter: blur(12px);
}

/*
 * 热力图面板：贴住页面下边界。
 * 这里**刻意不加 backdrop-filter**：面板横跨整页宽度且贴底，
 * 一旦 blur 就会把底部整条背景糊成黑块（用户反馈的"背景没了"）。
 * 背景图底部本身已偏暗，所以遮罩压得很轻，靠格子和文字自身的对比度保证可读。
 */
.sr-heatmap-panel {
  flex-shrink: 0;
  margin-top: auto;
  padding: 16px 18px 14px;
  border: 0;
  border-top: 1px solid rgb(255 255 255 / 0.1);
  border-radius: 0;
  background: linear-gradient(
    to bottom,
    rgb(10 16 14 / 0.06) 0%,
    rgb(10 16 14 / 0.2) 55%,
    rgb(10 16 14 / 0.3) 100%
  );
  backdrop-filter: none;
}

.sr-heatmap-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.sr-heatmap-head h2 {
  margin: 0;
  color: #fff;
  font-size: 15px;
  font-weight: 700;
}

.sr-heatmap-year {
  color: rgb(255 255 255 / 0.5);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.sr-heatmap-scroll {
  overflow-x: auto;
  padding-bottom: 4px;
}

.heatmap-months {
  position: relative;
  height: 18px;
  margin-left: 26px;
}

.heatmap-month {
  position: absolute;
  top: 2px;
  color: rgb(255 255 255 / 0.5);
  font-size: 10px;
  white-space: nowrap;
}

.heatmap-body {
  display: flex;
  gap: 6px;
}

.heatmap-weekdays {
  display: grid;
  grid-template-rows: repeat(7, 12px);
  gap: 3px;
  width: 20px;
  flex-shrink: 0;
}

.heatmap-weekdays span {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  color: rgb(255 255 255 / 0.45);
  font-size: 10px;
  line-height: 12px;
}

.heatmap-grid {
  display: flex;
  gap: 3px;
  min-width: max-content;
}

.heatmap-col {
  display: grid;
  grid-template-rows: repeat(7, 12px);
  gap: 3px;
}

.heatmap-cell {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  background: rgb(255 255 255 / 0.11);
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.05);
}

.heatmap-cell.checked {
  background: var(--study-room-primary);
}

.heatmap-cell.blank {
  background: transparent;
}

@media (max-width: 640px) {
  .island-header {
    flex-direction: column;
    gap: 12px;
  }

  .island-metrics {
    width: 100%;
  }

  .island-metric {
    flex: 1;
    padding: 10px 12px;
  }

  .island-actions {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .island-drag-hint {
    align-self: flex-start;
  }
}
</style>
