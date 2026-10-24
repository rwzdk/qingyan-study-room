<script lang="ts" setup>
import { defineAsyncComponent } from 'vue';

import { STATIC_MODE } from '#/lib/app-mode';

const SessionGate = STATIC_MODE
  ? null
  : defineAsyncComponent(() => import('#/views/auth/SessionGate.vue'));
</script>

<template>
  <component :is="SessionGate" v-if="SessionGate">
    <router-view />
  </component>
  <router-view v-else />
</template>
