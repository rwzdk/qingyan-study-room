<script setup lang="ts">
import type { PixelIconName } from '#/lib/pixel-icons';

withDefaults(
  defineProps<{
    name: PixelIconName;
    size?: number | string;
  }>(),
  { size: 16 },
);
</script>

<template>
  <svg
    class="pixel-icon"
    :width="size"
    :height="size"
    viewBox="0 0 16 16"
    fill="currentColor"
    shape-rendering="crispEdges"
    aria-hidden="true"
    focusable="false"
  >
    <g v-if="name === 'island'">
      <rect x="6" y="1" width="4" height="2" />
      <rect x="5" y="3" width="6" height="2" />
      <rect x="7" y="5" width="2" height="2" opacity=".85" />
      <rect x="4" y="7" width="8" height="2" />
      <rect x="2" y="9" width="12" height="2" />
      <rect x="4" y="11" width="8" height="2" opacity=".65" />
      <rect x="6" y="13" width="4" height="1" opacity=".5" />
      <rect x="2" y="13" width="2" height="1" opacity=".4" />
      <rect x="12" y="12" width="2" height="1" opacity=".4" />
    </g>
    <g v-else-if="name === 'focus'">
      <rect x="3" y="2" width="10" height="2" />
      <rect x="4" y="4" width="8" height="1" />
      <rect x="5" y="5" width="6" height="1" />
      <rect x="6" y="6" width="4" height="1" />
      <rect x="7" y="7" width="2" height="2" opacity=".6" />
      <rect x="6" y="9" width="4" height="1" />
      <rect x="5" y="10" width="6" height="1" />
      <rect x="4" y="11" width="8" height="1" />
      <rect x="3" y="12" width="10" height="2" />
    </g>
    <g v-else-if="name === 'plans'">
      <rect x="3" y="2" width="2" height="12" />
      <rect x="5" y="2" width="8" height="2" />
      <rect x="5" y="4" width="6" height="2" />
      <rect x="5" y="6" width="4" height="2" />
      <rect x="2" y="14" width="4" height="1" opacity=".6" />
    </g>
    <g v-else-if="name === 'docs'">
      <rect x="3" y="4" width="10" height="9" />
      <rect x="2" y="13" width="12" height="1" />
      <rect x="3" y="4" width="2" height="9" opacity=".55" />
      <rect x="9" y="1" width="2" height="5" />
    </g>
    <g v-else-if="name === 'home'">
      <rect x="2" y="13" width="12" height="1" />
      <rect x="3" y="8" width="2" height="5" />
      <rect x="7" y="5" width="2" height="8" />
      <rect x="11" y="3" width="2" height="10" />
    </g>
  </svg>
</template>

<style scoped>
.pixel-icon {
  display: block;
  flex-shrink: 0;
}
</style>
