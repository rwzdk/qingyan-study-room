<script lang="ts" setup>
import { defineAsyncComponent } from 'vue';

import { STATIC_MODE } from '#/lib/app-mode';

const AuthGate = STATIC_MODE
  ? defineAsyncComponent(() => import('#/views/auth/LocalAuthGate.vue'))
  : defineAsyncComponent(() => import('#/views/auth/SessionGate.vue'));
</script>

<template>
  <AuthGate>
    <router-view />
  </AuthGate>
</template>
