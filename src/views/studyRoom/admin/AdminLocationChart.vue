<script lang="ts" setup>
import { computed } from 'vue';

import type { AdminLocation } from '#/api/study-cloud';
import type { EChartsCoreOption } from 'echarts/core';

import AdminEChart from './AdminEChart.vue';
import { locationLabel } from './admin-format';

const props = defineProps<{ locations: AdminLocation[] }>();

const rows = computed(() =>
  props.locations.map((item) => ({
    label: locationLabel(item),
    sessions: item.sessions,
    users: item.users,
  })),
);

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
  },
  grid: { left: 88, right: 32, top: 10, bottom: 10 },
  xAxis: {
    type: 'value',
    minInterval: 1,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { show: false },
    splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.06)' } },
  },
  yAxis: {
    type: 'category',
    inverse: true,
    data: rows.value.map((row) => row.label),
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: {
      color: 'rgba(255, 255, 255, 0.62)',
      fontSize: 10,
      width: 80,
      overflow: 'truncate',
    },
  },
  series: [
    {
      name: '登录次数',
      type: 'bar',
      barMaxWidth: 10,
      itemStyle: {
        color: '#d7ef83',
        borderRadius: [0, 5, 5, 0],
      },
      label: {
        show: true,
        position: 'right',
        color: 'rgba(255, 255, 255, 0.48)',
        fontSize: 9,
        formatter: '{c} 次',
      },
      data: rows.value.map((row) => row.sessions),
    },
  ],
}));
</script>

<template>
  <div class="location-chart">
    <AdminEChart
      v-if="rows.length"
      :option="option"
      :height="Math.max(150, rows.length * 30 + 16)"
      label="近 30 天登录地点分布"
    />
    <p v-else class="location-empty">还没有登录地点数据</p>
  </div>
</template>

<style scoped>
.location-chart {
  padding: 0 10px 8px;
}

.location-empty {
  margin: 0;
  padding: 34px 0;
  color: rgb(255 255 255 / 0.4);
  font-size: 12px;
  text-align: center;
}
</style>
