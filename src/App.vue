<script lang="ts" setup>
import SessionGate from '#/views/auth/SessionGate.vue';
</script>

<template>
  <SessionGate>
    <router-view />
  </SessionGate>
</template>
