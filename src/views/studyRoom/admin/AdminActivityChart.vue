<script lang="ts" setup>
import { computed } from 'vue';

import type { AdminActivityPoint } from '#/api/study-cloud';
import type { EChartsCoreOption } from 'echarts/core';

import AdminEChart from './AdminEChart.vue';
import { dayLabel } from './admin-format';

const props = defineProps<{ points: AdminActivityPoint[] }>();

const option = computed<EChartsCoreOption>(() => ({
  backgroundColor: 'transparent',
  animationDuration: 420,
  color: ['#d7ef83', '#6fd3c7'],
  aria: { enabled: true },
  tooltip: {
    trigger: 'axis',
    backgroundColor: 'rgba(8, 18, 14, 0.94)',
    borderColor: 'rgba(215, 239, 131, 0.28)',
    borderWidth: 1,
    textStyle: { color: '#ffffff', fontSize: 11 },
    axisPointer: { type: 'line', lineStyle: { color: 'rgba(255, 255, 255, 0.18)' } },
  },
  legend: {
    top: 0,
    right: 4,
    icon: 'circle',
    itemWidth: 8,
    itemHeight: 8,
    textStyle: { color: 'rgba(255, 255, 255, 0.55)', fontSize: 10 },
    data: ['登录次数', '登录用户'],
  },
  grid: { left: 34, right: 14, top: 34, bottom: 24 },
  xAxis: {
    type: 'category',
    boundaryGap: false,
    data: props.points.map((point) => dayLabel(point.date)),
    axisLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.1)' } },
    axisTick: { show: false },
    axisLabel: {
      color: 'rgba(255, 255, 255, 0.4)',
      fontSize: 10,
      interval: 2,
    },
  },
  yAxis: {
    type: 'value',
    minInterval: 1,
    splitNumber: 4,
    axisLabel: { color: 'rgba(255, 255, 255, 0.4)', fontSize: 10 },
    splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.07)' } },
  },
  series: [
    {
      name: '登录次数',
      type: 'line',
      smooth: true,
      symbol: 'none',
      lineStyle: { width: 2 },
      areaStyle: { opacity: 0.16 },
      data: props.points.map((point) => point.logins),
    },
    {
      name: '登录用户',
      type: 'line',
      smooth: true,
      symbol: 'none',
      lineStyle: { width: 2, type: 'dashed' },
      data: props.points.map((point) => point.users),
    },
  ],
}));
</script>

<template>
  <div class="activity-chart">
    <AdminEChart
      :option="option"
      :height="230"
      label="近 14 天登录次数与登录用户趋势"
    />
  </div>
</template>

<style scoped>
.activity-chart {
  padding: 0 10px 8px;
}
</style>
