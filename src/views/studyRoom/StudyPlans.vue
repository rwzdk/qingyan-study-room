<script lang="ts" setup>
import { computed, ref, watch } from 'vue';

import IconifyIcon from '#/components/IconifyIcon.vue';

import { scheduleSaveStudyRoom, useStudyRoomState } from './study-room-state-store';

interface PlanTask {
  id: string;
  title: string;
  done: boolean;
}

interface Plan {
  id: string;
  name: string;
  goal: string;
  tasks: PlanTask[];
  createdAt: string;
}

const { state } = useStudyRoomState();

const plans = ref<Plan[]>([]);
const showCreate = ref(false);
const newName = ref('');
const newGoal = ref('');
const expandedId = ref('');
const newTaskTitle = ref('');

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ---------- 派生指标 ---------- */

function planProgress(plan: Plan): number {
  if (plan.tasks.length === 0) return 0;
  const done = plan.tasks.filter((t) => t.done).length;
  return Math.round((done / plan.tasks.length) * 100);
}

const totalTasks = computed(() =>
  plans.value.reduce((sum, plan) => sum + plan.tasks.length, 0),
);

const doneTasks = computed(() =>
  plans.value.reduce((sum, plan) => sum + plan.tasks.filter((t) => t.done).length, 0),
);

const avgProgress = computed(() => {
  if (plans.value.length === 0) return 0;
  const sum = plans.value.reduce((acc, plan) => acc + planProgress(plan), 0);
  return Math.round(sum / plans.value.length);
});

/* ---------- 交互 ---------- */

function toggleExpand(planId: string) {
  expandedId.value = expandedId.value === planId ? '' : planId;
  // 切换展开目标时清掉残留的任务输入，避免串到别的计划。
  newTaskTitle.value = '';
}

function createPlan() {
  const name = newName.value.trim();
  if (!name) return;
  plans.value = [
    {
      id: createId('plan'),
      name,
      goal: newGoal.value.trim(),
      tasks: [],
      createdAt: new Date().toISOString(),
    },
    ...plans.value,
  ];
  newName.value = '';
  newGoal.value = '';
  showCreate.value = false;
  state.value.plans = plans.value;
  scheduleSaveStudyRoom();
}

function toggleTask(planId: string, taskId: string) {
  plans.value = plans.value.map((plan) =>
    plan.id === planId
      ? {
          ...plan,
          tasks: plan.tasks.map((task) =>
            task.id === taskId ? { ...task, done: !task.done } : task,
          ),
        }
      : plan,
  );
  state.value.plans = plans.value;
  scheduleSaveStudyRoom();
}

function addTask(plan: Plan) {
  const title = newTaskTitle.value.trim();
  if (!title) return;
  plans.value = plans.value.map((p) =>
    p.id === plan.id
      ? {
          ...p,
          tasks: [...p.tasks, { id: createId('task'), title, done: false }],
        }
      : p,
  );
  newTaskTitle.value = '';
  state.value.plans = plans.value;
  scheduleSaveStudyRoom();
}

// 本地状态加载完成后再同步到编辑副本（避免竞态读到空数组）
watch(
  () => state.value.plans,
  (next) => {
    plans.value = Array.isArray(next) ? next : [];
  },
  { immediate: true },
);
</script>

<template>
  <div class="study-room-extension">
    <div class="sr-ext-header">
      <div class="header-copy">
        <p class="eyebrow">Learning map</p>
        <h1>计划</h1>
        <p class="subtitle">把长期目标收拢成清晰、能执行的下一步。</p>
      </div>
      <button type="button" class="sr-btn" @click="showCreate = !showCreate">
        <IconifyIcon icon="lucide:plus" />
        新建计划
      </button>
    </div>

    <!-- 新建计划：内联输入区 -->
    <div v-if="showCreate" class="sr-panel create-panel">
      <input
        v-model="newName"
        class="sr-input"
        type="text"
        placeholder="计划名称"
        aria-label="计划名称"
        @keydown.enter="createPlan"
      />
      <input
        v-model="newGoal"
        class="sr-input"
        type="text"
        placeholder="目标（可选）"
        aria-label="目标"
        @keydown.enter="createPlan"
      />
      <div class="create-actions">
        <button type="button" class="sr-btn sr-btn--ghost" @click="showCreate = false">取消</button>
        <button type="button" class="sr-btn" :disabled="!newName.trim()" @click="createPlan">创建</button>
      </div>
    </div>

    <!-- 指标行 -->
    <div class="plans-metrics">
      <div class="sr-metric">
        <span class="sr-metric-icon"><IconifyIcon icon="lucide:list-checks" /></span>
        <div>
          <p class="sr-metric-label">全部计划</p>
          <p class="sr-metric-value">{{ plans.length }}<span class="sr-metric-unit">项</span></p>
        </div>
      </div>
      <div class="sr-metric">
        <span class="sr-metric-icon"><IconifyIcon icon="lucide:flag" /></span>
        <div>
          <p class="sr-metric-label">平均进度</p>
          <p class="sr-metric-value">{{ avgProgress }}<span class="sr-metric-unit">%</span></p>
        </div>
      </div>
      <div class="sr-metric">
        <span class="sr-metric-icon"><IconifyIcon icon="lucide:check-circle" /></span>
        <div>
          <p class="sr-metric-label">已完成任务</p>
          <p class="sr-metric-value">{{ doneTasks }}<span class="sr-metric-unit">/ {{ totalTasks }}</span></p>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="plans.length === 0" class="sr-empty">
      <IconifyIcon icon="lucide:flag" class="empty-icon" />
      <h3>从一个明确的目标开始</h3>
      <p>计划不需要复杂，先写下明确的目标，再逐步补充任务。</p>
    </div>

    <!-- 计划列表 -->
    <div v-else class="plan-list">
      <div v-for="plan in plans" :key="plan.id" class="sr-panel plan-card">
        <div
          class="plan-head"
          role="button"
          tabindex="0"
          :aria-expanded="expandedId === plan.id"
          @click="toggleExpand(plan.id)"
          @keydown.enter="toggleExpand(plan.id)"
        >
          <div class="plan-info">
            <h3>{{ plan.name }}</h3>
            <p v-if="plan.goal">{{ plan.goal }}</p>
            <p v-else class="plan-goal-empty">尚未填写目标</p>
          </div>
          <div class="plan-head-right">
            <span class="plan-progress-num">{{ planProgress(plan) }}%</span>
            <IconifyIcon
              icon="lucide:chevron-down"
              class="plan-chevron"
              :class="{ open: expandedId === plan.id }"
            />
          </div>
        </div>

        <div class="plan-progress-track">
          <div class="plan-progress-fill" :style="{ width: `${planProgress(plan)}%` }" />
        </div>

        <div v-if="expandedId === plan.id" class="plan-tasks">
          <p v-if="plan.tasks.length === 0" class="plan-tasks-empty">还没有任务，先加一件能开始的小事。</p>
          <div
            v-for="task in plan.tasks"
            :key="task.id"
            class="plan-task"
            role="checkbox"
            :aria-checked="task.done"
            tabindex="0"
            @click="toggleTask(plan.id, task.id)"
            @keydown.enter="toggleTask(plan.id, task.id)"
            @keydown.space.prevent="toggleTask(plan.id, task.id)"
          >
            <span class="plan-task-check" :class="{ done: task.done }">
              <IconifyIcon v-if="task.done" icon="lucide:check" />
            </span>
            <span class="plan-task-title" :class="{ done: task.done }">{{ task.title }}</span>
          </div>

          <div class="plan-task-add">
            <input
              v-model="newTaskTitle"
              class="sr-input"
              type="text"
              placeholder="添加任务，回车确认"
              aria-label="添加任务"
              @keydown.enter="addTask(plan)"
            />
            <button type="button" class="sr-btn sr-btn--ghost" @click="addTask(plan)">添加</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.header-copy {
  min-width: 0;
}

.empty-icon {
  width: 32px;
  height: 32px;
  color: var(--study-room-primary);
}

.plans-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.plans-metrics .sr-metric-label {
  margin: 0;
}

.plans-metrics .sr-metric-value {
  margin: 2px 0 0;
}

.create-panel {
  display: grid;
  gap: 10px;
  padding: 14px;
  margin-bottom: 16px;
}

.create-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}

.create-actions .sr-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.plan-list {
  display: grid;
  gap: 12px;
}

.plan-card {
  padding: 16px;
}

.plan-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
}

.plan-head:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--study-room-primary) 60%, transparent);
  outline-offset: 2px;
  border-radius: 6px;
}

.plan-info {
  flex: 1;
  min-width: 0;
}

.plan-info h3 {
  margin: 0;
  color: #fff;
  font-size: 16px;
  font-weight: 700;
}

.plan-info p {
  margin: 6px 0 0;
  color: rgb(255 255 255 / 0.55);
  font-size: 13px;
  line-height: 1.5;
}

.plan-goal-empty {
  font-style: italic;
}

.plan-head-right {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
}

.plan-progress-num {
  color: var(--study-room-primary);
  font-size: 14px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.plan-chevron {
  color: rgb(255 255 255 / 0.45);
  transition: transform 0.2s ease;
}

.plan-chevron.open {
  transform: rotate(180deg);
}

.plan-progress-track {
  height: 6px;
  margin-top: 12px;
  overflow: hidden;
  border-radius: 999px;
  background: rgb(255 255 255 / 0.08);
}

.plan-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--study-room-primary);
  transition: width 0.3s ease;
}

.plan-tasks {
  display: grid;
  gap: 6px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid rgb(255 255 255 / 0.1);
}

.plan-tasks-empty {
  margin: 0;
  padding: 6px 0;
  color: rgb(255 255 255 / 0.4);
  font-size: 12px;
}

.plan-task {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.plan-task:hover {
  background: rgb(255 255 255 / 0.04);
}

.plan-task:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--study-room-primary) 60%, transparent);
  outline-offset: -2px;
}

.plan-task-check {
  display: flex;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid rgb(255 255 255 / 0.35);
  border-radius: 4px;
  color: #051612;
  transition: all 0.15s ease;
}

.plan-task-check.done {
  border-color: var(--study-room-primary);
  background: var(--study-room-primary);
}

.plan-task-title {
  color: #fff;
  font-size: 13px;
}

.plan-task-title.done {
  color: rgb(255 255 255 / 0.4);
  text-decoration: line-through;
}

.plan-task-add {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.plan-task-add .sr-input {
  flex: 1;
}

@media (max-width: 768px) {
  .plans-metrics {
    grid-template-columns: 1fr;
  }

  .plan-task-add {
    flex-direction: column;
  }
}
</style>
