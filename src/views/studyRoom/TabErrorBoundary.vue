<script lang="ts" setup>
/**
 * 局部错误边界。
 *
 * 为什么需要：自习室各个 tab 是 v-if 切换的兄弟组件。Vue 的默认行为是
 * —— 子组件渲染期抛出未捕获异常时，错误会冒泡到根组件，导致**整个自习室
 * （包括顶栏导航）被卸载**，表现就是"点到某个菜单后整页空白，之后点什么都
 * 没反应"。这正是用户反馈的现象。
 *
 * 用 onErrorCaptured 把错误拦在当前 tab 内部：只让这一块显示兜底提示，
 * 顶栏和其它 tab 仍然可用，用户可以直接切走，不会被卡死。
 */
import { onErrorCaptured, ref, watch } from 'vue';

import IconifyIcon from '#/components/IconifyIcon.vue';

const props = defineProps<{
  /** 变化时自动清除错误状态（切换 tab 后重新尝试渲染）。 */
  resetKey?: string;
}>();

const errorMessage = ref('');
const errorDetail = ref('');

onErrorCaptured((err) => {
  const e = err as Error;
  errorMessage.value = e?.message || String(err);
  errorDetail.value = (e?.stack || '').split('\n').slice(0, 3).join('\n');
  // 阻止继续向上冒泡，避免整棵组件树被卸载
  return false;
});

watch(
  () => props.resetKey,
  () => {
    errorMessage.value = '';
    errorDetail.value = '';
  },
);

function retry() {
  errorMessage.value = '';
  errorDetail.value = '';
}

function reloadPage() {
  window.location.reload();
}
</script>

<template>
  <div v-if="errorMessage" class="tab-error-boundary" role="alert">
    <IconifyIcon icon="lucide:triangle-alert" class="tab-error-icon" />
    <h2>这个页面加载出错了</h2>
    <p class="tab-error-msg">{{ errorMessage }}</p>
    <pre v-if="errorDetail" class="tab-error-detail">{{ errorDetail }}</pre>
    <div class="tab-error-actions">
      <button type="button" class="tab-error-btn" @click="retry">重试</button>
      <button type="button" class="tab-error-btn tab-error-btn--ghost" @click="reloadPage">
        刷新页面
      </button>
    </div>
    <p class="tab-error-hint">其它菜单仍可正常使用，可直接切换到别的页面。</p>
  </div>
  <div v-else class="tab-error-content">
    <slot />
  </div>
</template>

<style scoped>
.tab-error-boundary {
  display: flex;
  min-height: 360px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 40px 24px;
  border: 1px solid rgb(255 255 255 / 0.14);
  border-radius: 14px;
  background: rgb(0 0 0 / 0.32);
  color: #fff;
  text-align: center;
  backdrop-filter: blur(14px);
}

.tab-error-icon {
  width: 34px;
  height: 34px;
  color: #fcd34d;
}

.tab-error-boundary h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
}

.tab-error-msg {
  max-width: 720px;
  margin: 0;
  color: #fca5a5;
  font-size: 13px;
  word-break: break-word;
}

.tab-error-detail {
  max-width: 720px;
  max-height: 96px;
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  border-radius: 8px;
  color: rgb(255 255 255 / 0.5);
  background: rgb(0 0 0 / 0.4);
  font-family: ui-monospace, monospace;
  font-size: 11px;
  text-align: left;
  white-space: pre-wrap;
}

.tab-error-actions {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}

.tab-error-btn {
  padding: 8px 20px;
  border: 0;
  border-radius: 999px;
  color: #051612;
  background: var(--study-room-primary, #d7ef83);
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  transition: all 0.18s ease;
}

.tab-error-btn:hover {
  transform: scale(1.03);
}

.tab-error-btn--ghost {
  border: 1px solid rgb(255 255 255 / 0.18);
  color: #fff;
  background: transparent;
}

.tab-error-hint {
  margin: 6px 0 0;
  color: rgb(255 255 255 / 0.45);
  font-size: 12px;
}
</style>
