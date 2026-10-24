<script setup lang="ts">
import { computed } from 'vue';

import { icons } from '#/lib/icons';

const props = defineProps<{
  icon: string;
  size?: string | number;
}>();

const resolved = computed(() => icons[props.icon]);
</script>

<template>
  <component
    :is="resolved"
    v-if="resolved"
    :size="size ?? '1em'"
    aria-hidden="true"
  />
  <span v-else aria-hidden="true" />
</template>
