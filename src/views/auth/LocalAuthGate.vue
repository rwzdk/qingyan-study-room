<script lang="ts" setup>
import { onMounted, ref, watch } from 'vue';

import { currentUser, restoreLocalSession } from '#/lib/local-auth';
import {
  hydrateLocalUser,
  resetForLogout,
} from '#/views/studyRoom/study-room-state-store';

import LocalLoginView from './LocalLoginView.vue';

const ready = ref(false);

onMounted(() => {
  const user = restoreLocalSession();
  if (user) hydrateLocalUser(user.id);
  ready.value = true;
});

watch(currentUser, (user) => {
  if (!ready.value) return;
  if (user) hydrateLocalUser(user.id);
  else resetForLogout();
});
</script>

<template>
  <div v-if="!ready" class="local-auth-boot">正在进入自习室…</div>
  <LocalLoginView v-else-if="!currentUser" />
  <slot v-else />
</template>

<style scoped>
.local-auth-boot {
  display: grid;
  min-height: 100vh;
  place-items: center;
  color: rgb(255 255 255 / 0.7);
  background: #141b16;
  font-size: 14px;
}
</style>
