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
  color: ['#d7ef83'],
  aria: { enabled: true },
  tooltip: {
    trigger: 'axis',
    backgroundColor: 'rgba(8, 18, 14, 0.94)',
    borderColor: 'rgba(215, 239, 131, 0.28)',
    borderWidth: 1,
    textStyle: { color: '#ffffff', fontSize: 11 },
    axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(255, 255, 255, 0.04)' } },
  },
  grid: { left: 30, right: 12, top: 18, bottom: 24 },
  xAxis: {
    type: 'category',
    data: props.points.map((point) => dayLabel(point.date)),
    axisLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.1)' } },
    axisTick: { show: false },
    axisLabel: {
      color: 'rgba(255, 255, 255, 0.4)',
      fontSize: 10,
      interval: 3,
    },
  },
  yAxis: {
    type: 'value',
    minInterval: 1,
    splitNumber: 3,
    axisLabel: { color: 'rgba(255, 255, 255, 0.4)', fontSize: 10 },
    splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.07)' } },
  },
  series: [
    {
      name: '新增注册',
      type: 'bar',
      barMaxWidth: 16,
      itemStyle: {
        color: '#d7ef83',
        borderRadius: [5, 5, 2, 2],
      },
      data: props.points.map((point) => point.registrations),
    },
  ],
}));
</script>

<template>
  <div class="register-chart">
    <AdminEChart
      :option="option"
      :height="230"
      label="近 14 天每日注册人数柱状图"
    />
  </div>
</template>

<style scoped>
.register-chart {
  padding: 0 10px 8px;
}
</style>
