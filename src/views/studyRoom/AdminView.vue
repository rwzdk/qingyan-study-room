<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import {
  cachedAdminStats,
  cloudAdminStats,
  readCloudSession,
  type AdminStats,
} from '#/api/study-cloud';
import AdminActivityChart from './admin/AdminActivityChart.vue';
import AdminLocationChart from './admin/AdminLocationChart.vue';
import AdminRegisterChart from './admin/AdminRegisterChart.vue';
import { locationLabel } from './admin/admin-format';

// 切走再切回来时组件会重新挂载：先用上一次的结果顶住首屏，数据在背后刷新。
const stats = ref<AdminStats | null>(cachedAdminStats());
const loading = ref(stats.value === null);
const error = ref('');
const refreshing = ref(false);

function clockOf(iso: string | undefined): string {
  const value = Date.parse(iso ?? '');
  return Number.isFinite(value)
    ? new Date(value).toLocaleTimeString('zh-CN', { hour12: false })
    : '';
}

const updatedAt = ref(clockOf(stats.value?.now));

let timer: ReturnType<typeof setInterval> | null = null;

async function load(): Promise<void> {
  const session = readCloudSession();
  if (!session) {
    error.value = '登录已过期，请重新登录';
    loading.value = false;
    return;
  }
  refreshing.value = true;
  try {
    stats.value = await cloudAdminStats(session.token);
    error.value = '';
    updatedAt.value = clockOf(stats.value?.now);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '加载失败';
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function relative(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff)) return '—';
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

function deviceOf(ua: string): string {
  if (!ua) return '未知设备';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : '浏览器';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Mac OS X/.test(ua)
      ? 'macOS'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} · ${os}` : browser;
}

const onlineWindow = computed(() => stats.value?.runtime.onlineWindowMinutes ?? 5);
const totalLogins = computed(
  () => stats.value?.activity.reduce((sum, point) => sum + point.logins, 0) ?? 0,
);
const totalRegistrations = computed(
  () =>
    stats.value?.activity.reduce((sum, point) => sum + point.registrations, 0) ?? 0,
);

onMounted(() => {
  void load();
  timer = setInterval(() => {
    if (!document.hidden) void load();
  }, 30_000);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  timer = null;
});
</script>

<template>
  <div class="admin-view">
    <header class="admin-head">
      <div>
        <p class="admin-eyebrow">ADMIN</p>
        <h1>运行监控</h1>
        <p class="admin-sub">只对管理员可见，每 30 秒自动刷新。</p>
      </div>
      <div class="admin-head-side">
        <span class="admin-updated">{{ updatedAt ? `更新于 ${updatedAt}` : '尚未加载' }}</span>
        <button type="button" class="admin-refresh" :disabled="refreshing" @click="load">
          {{ refreshing ? '刷新中' : '刷新' }}
        </button>
      </div>
    </header>

    <p v-if="error" class="admin-error" role="alert">{{ error }}</p>

    <div v-if="loading && !stats" class="admin-loading">正在读取云端统计…</div>

    <template v-else-if="stats">
      <div class="admin-cards">
        <article class="admin-card">
          <span class="admin-card-label">注册用户</span>
          <strong>{{ stats.users.total }}</strong>
          <span class="admin-card-foot">
            今日 +{{ stats.users.today }} · 近 7 天 +{{ stats.users.week }}
          </span>
        </article>
        <article class="admin-card">
          <span class="admin-card-label">当前在线</span>
          <strong>{{ stats.users.online }}</strong>
          <span class="admin-card-foot">
            {{ onlineWindow }} 分钟内活跃 · 会话 {{ stats.sessions.active }}
          </span>
        </article>
        <article class="admin-card">
          <span class="admin-card-label">云端数据</span>
          <strong>{{ formatBytes(stats.storage.bytes) }}</strong>
          <span class="admin-card-foot">
            {{ stats.storage.rows }} 份 · 今日更新 {{ stats.storage.updatedToday }}
          </span>
        </article>
        <article class="admin-card">
          <span class="admin-card-label">对话消息</span>
          <strong>{{ stats.chat.messages }}</strong>
          <span class="admin-card-foot">今日发言 {{ stats.chat.authorsToday }} 人</span>
        </article>
      </div>

      <div class="admin-charts">
        <section class="admin-panel admin-panel--wide">
          <header class="admin-panel-head">
            <h2>近 14 天活跃</h2>
            <span>登录 {{ totalLogins }} 次</span>
          </header>
          <AdminActivityChart :points="stats.activity" />
        </section>
        <section class="admin-panel">
          <header class="admin-panel-head">
            <h2>每日注册</h2>
            <span>{{ totalRegistrations }} 人</span>
          </header>
          <AdminRegisterChart :points="stats.activity" />
        </section>
      </div>

      <div class="admin-grid">
        <section class="admin-panel">
          <header class="admin-panel-head">
            <h2>登录地点</h2>
            <span>近 30 天</span>
          </header>
          <AdminLocationChart :locations="stats.locations" />
        </section>

        <section class="admin-panel">
          <header class="admin-panel-head">
            <h2>最近登录</h2>
            <span>{{ stats.recentLogins.length }}</span>
          </header>
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>用户</th>
                  <th>地点</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in stats.recentLogins" :key="`${item.username}-${item.at}`">
                  <td>{{ item.username }}</td>
                  <td class="admin-device admin-location">{{ locationLabel(item) }}</td>
                  <td>{{ relative(item.at) }}</td>
                </tr>
              </tbody>
            </table>
            <p v-if="!stats.recentLogins.length" class="admin-empty">还没有登录记录</p>
          </div>
        </section>
      </div>

      <div class="admin-grid">
        <section class="admin-panel">
          <header class="admin-panel-head">
            <h2>在线用户</h2>
            <span>{{ stats.online.length }}</span>
          </header>
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>用户</th>
                  <th>地点</th>
                  <th>最近活跃</th>
                  <th class="admin-col-device">设备</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="user in stats.online" :key="user.userId">
                  <td>{{ user.username }}</td>
                  <td class="admin-device admin-location">{{ locationLabel(user) }}</td>
                  <td>{{ relative(user.lastSeenAt) }}</td>
                  <td class="admin-device admin-col-device">{{ deviceOf(user.userAgent) }}</td>
                </tr>
              </tbody>
            </table>
            <p v-if="!stats.online.length" class="admin-empty">
              最近 {{ onlineWindow }} 分钟没有活跃用户
            </p>
          </div>
        </section>

        <section class="admin-panel">
          <header class="admin-panel-head">
            <h2>最近更新</h2>
            <span>{{ stats.recent.length }}</span>
          </header>
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>用户</th>
                  <th>更新时间</th>
                  <th>数据量</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in stats.recent" :key="item.userId">
                  <td>{{ item.username }}</td>
                  <td>{{ relative(item.updatedAt) }}</td>
                  <td class="admin-device">{{ formatBytes(item.bytes) }}</td>
                </tr>
              </tbody>
            </table>
            <p v-if="!stats.recent.length" class="admin-empty">还没有云端数据</p>
          </div>
        </section>
      </div>

      <footer class="admin-runtime">
        <span>边缘节点 {{ stats.runtime.colo || '—' }}</span>
        <span v-if="stats.runtime.city || stats.runtime.region">
          {{ [stats.runtime.city, stats.runtime.region].filter(Boolean).join(' · ') }}
        </span>
        <span v-if="stats.runtime.timezone">{{ stats.runtime.timezone }}</span>
        <span v-if="stats.storage.lastUpdatedAt">
          最近一次数据写入 {{ relative(stats.storage.lastUpdatedAt) }}
        </span>
        <span>服务器时间 {{ new Date(stats.now).toLocaleString('zh-CN', { hour12: false }) }}</span>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.admin-view {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 4px 0 8px;
}

.admin-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}

.admin-eyebrow {
  margin: 0 0 6px;
  color: var(--study-room-primary);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.14em;
}

.admin-head h1 {
  margin: 0;
  color: #fff;
  font-size: 26px;
  font-weight: 800;
}

.admin-sub {
  margin: 6px 0 0;
  color: rgb(255 255 255 / 0.55);
  font-size: 13px;
}

.admin-head-side {
  display: flex;
  align-items: center;
  gap: 12px;
}

.admin-updated {
  color: rgb(255 255 255 / 0.45);
  font-size: 12px;
}

.admin-refresh {
  padding: 8px 16px;
  border: 1px solid color-mix(in srgb, var(--study-room-primary) 35%, transparent);
  border-radius: 999px;
  color: var(--study-room-primary);
  background: color-mix(in srgb, var(--study-room-primary) 12%, transparent);
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
}

.admin-refresh:disabled {
  opacity: 0.6;
  cursor: default;
}

.admin-error {
  margin: 0;
  padding: 10px 14px;
  border: 1px solid rgb(255 120 120 / 0.3);
  border-radius: 12px;
  color: #ffb4b4;
  background: rgb(120 30 30 / 0.25);
  font-size: 13px;
}

.admin-loading {
  padding: 40px 0;
  color: rgb(255 255 255 / 0.55);
  font-size: 14px;
  text-align: center;
}

.admin-cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.admin-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px 18px;
  border: 1px solid rgb(255 255 255 / 0.08);
  border-radius: 16px;
  background: rgb(9 17 14 / 0.55);
  backdrop-filter: blur(18px);
}

.admin-card-label {
  color: rgb(255 255 255 / 0.5);
  font-size: 12px;
  letter-spacing: 0.08em;
}

.admin-card strong {
  color: #fff;
  font-size: 26px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.admin-card-foot {
  color: rgb(255 255 255 / 0.45);
  font-size: 12px;
}

.admin-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}

.admin-charts {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr);
  gap: 12px;
}

.admin-panel {
  border: 1px solid rgb(255 255 255 / 0.08);
  border-radius: 16px;
  background: rgb(9 17 14 / 0.55);
  backdrop-filter: blur(18px);
  overflow: hidden;
}

.admin-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px 10px;
}

.admin-panel-head h2 {
  margin: 0;
  color: #fff;
  font-size: 15px;
  font-weight: 700;
}

.admin-panel-head span {
  color: rgb(255 255 255 / 0.45);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.admin-table-wrap {
  max-height: 320px;
  overflow: auto;
}

.admin-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 13px;
}

.admin-table th {
  position: sticky;
  top: 0;
  z-index: 2;
  padding: 8px 18px;
  color: rgb(255 255 255 / 0.4);
  background: #0b1511;
  font-size: 11px;
  font-weight: 600;
  text-align: left;
  letter-spacing: 0.06em;
}

.admin-table td {
  padding: 9px 18px;
  border-top: 1px solid rgb(255 255 255 / 0.05);
  color: rgb(255 255 255 / 0.82);
  white-space: nowrap;
}

.admin-table tbody tr:hover td {
  background: rgb(255 255 255 / 0.03);
}

.admin-device {
  color: rgb(255 255 255 / 0.5);
}

.admin-location {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.admin-empty {
  margin: 0;
  padding: 26px 18px;
  color: rgb(255 255 255 / 0.4);
  font-size: 13px;
  text-align: center;
}

.admin-runtime {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  color: rgb(255 255 255 / 0.42);
  font-size: 12px;
}

@media (max-width: 900px) {
  .admin-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .admin-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .admin-charts {
    grid-template-columns: minmax(0, 1fr);
  }

  .admin-head {
    flex-direction: column;
    align-items: flex-start;
  }
}

@media (max-width: 600px) {
  .admin-col-device {
    display: none;
  }
}
</style>