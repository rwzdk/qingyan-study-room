<script lang="ts" setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { BarChart, LineChart } from 'echarts/charts';
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import type { EChartsCoreOption, EChartsType } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  LineChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  AriaComponent,
  CanvasRenderer,
]);

const props = withDefaults(
  defineProps<{
    option: EChartsCoreOption;
    height?: number;
    label?: string;
  }>(),
  {
    height: 240,
    label: '',
  },
);

const host = ref<HTMLDivElement | null>(null);
let chart: EChartsType | null = null;
let observer: ResizeObserver | null = null;

onMounted(() => {
  if (!host.value) return;
  chart = echarts.init(host.value, undefined, { renderer: 'canvas' });
  chart.setOption(props.option);
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => chart?.resize());
    observer.observe(host.value);
  }
});

watch(
  () => props.option,
  (next) => {
    chart?.setOption(next, true);
  },
  { deep: true },
);

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
  chart?.dispose();
  chart = null;
});
</script>

<template>
  <div
    ref="host"
    class="admin-echart"
    role="img"
    :aria-label="label"
    :style="{ height: `${height}px` }"
  />
</template>

<style scoped>
.admin-echart {
  width: 100%;
  min-width: 0;
}
</style>
