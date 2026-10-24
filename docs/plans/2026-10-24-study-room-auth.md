# 清砚自习室登录与云端同步实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:dispatching-parallel-agents. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 给独立版自习室增加 Qoder 账号登录、按用户云端同步、首次登录迁移，并把站点公开。

**Architecture:** Vue 3 前端 + Qoder Sites Function（Deno edge）+ PostgreSQL。Function 用 Qoder 请求上下文识别用户，按 `user_id` 读写 `app.study_room_states`；前端强制登录、缓存与乐观锁同步。

**Tech Stack:** Vue 3、TypeScript、Vite、Element Plus、Qoder Sites Functions、Supabase 适配器、Vitest。

**Spec:** `E:\projects\study-room\docs\specs\2026-10-24-study-room-auth-design.md`

## Global Constraints

- 项目根目录 `E:\projects\study-room`；部署镜像 `E:\projects\qc-student\artifacts\study-room-site`（当前会话工作区内，已 gitignore）。
- 登录使用 Qoder 账号；不实现站内密码。
- Function 必须从 `x-qoder-user-context` 取 `user_id`，忽略浏览器提交的身份。
- 数据库只授予 `select/insert/update`，不授予 `delete`。
- 请求体上限 1 MiB；前端提交前检查 900 KiB。
- 站点公开访问；任何 Qoder 用户登录后各自一份数据。
- 不提交 Git（除非用户明确要求）。
- 现有五个页签、场景、计时器、导出/导入功能不回归。

## 文件所有权与并行

| Agent | 文件 | 依赖 |
| --- | --- | --- |
| A（后端） | `functions/*`、`dev/fake-supabase.mjs`、`dev/function-local.mjs`、`tests/functions/handler.test.ts`、`vitest.config.ts` 的 include | 无 |
| B（同步核心） | `src/api/study-room-sync.ts`、`src/session/*`、`src/lib/profile-state.ts`、`src/lib/local-user.ts`、`src/views/studyRoom/study-room-state-store.ts`、`src/App.vue`、`src/views/auth/*`、相关测试 | 无 |
| C（UI 集成） | `src/views/studyRoom/RoomTopBar.vue`、`StudyHome.vue`、`index.vue`、`vite.config.ts` 代理、README | B 完成后 |
| 主 Agent | 集成、构建、浏览器测试、数据库/发布/公开访问 | A/B/C 完成后 |

A 与 B 可并行；C 等 B 的接口稳定后开始。

---

## Task 1: Function 与数据库访问层（Agent A）

**Files:**
- Create: `functions/index.ts`
- Create: `functions/adapter.mjs`（从 Qoder 示例原样复制）
- Create: `functions/auth.mjs`（原样复制）
- Create: `functions/handler.mjs`
- Create: `dev/fake-supabase.mjs`
- Create: `dev/function-local.mjs`
- Create: `tests/functions/handler.test.ts`
- Modify: `vitest.config.ts`（include 同时保留 `src/**/__tests__/**/*.test.ts` 和新增 `tests/**/*.test.ts`）

**Interfaces:**
- `handleStudyRoom({ request, supabase })` 返回 `Response`
- `GET ?action=bootstrap`、`PUT ?action=state`
- 错误码与 spec 一致

- [ ] **Step 1: 复制平台文件**

从以下目录复制，内容不要改：

```text
D:\software\Qoder\.qoder-versions\0.4.4\resources\extensions\qoder.sites\cli\sites\skills\sites-building\assets\database-function\adapter.mjs
D:\software\Qoder\.qoder-versions\0.4.4\resources\extensions\qoder.sites\cli\sites\skills\sites-building\assets\user-context\auth.mjs
```

- [ ] **Step 2: 写 `functions/index.ts`**

```ts
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

import { serveSite } from './adapter.mjs';
import { handleStudyRoom } from './handler.mjs';

Deno.serve(
  serveSite(handleStudyRoom, {
    createClient,
    env: (name: string) => Deno.env.get(name),
  }),
);
```

- [ ] **Step 3: 写 `functions/handler.mjs`**

要求：

- 只处理 `action=bootstrap`（GET）和 `action=state`（PUT）；未知 action 返回 404，错误方法返回 405 并带 `allow`。
- `requireUser(request)` 捕获 `UserContextError`，返回其 `code/status`。
- 整个 handler 用 try/catch 包住；未知异常返回 `503 write_result_unknown`（读路径 `state_unavailable`），不要依赖 adapter 吞异常。
- PUT 必须 `content-type: application/json`，否则 415。
- `baseUpdatedAt` 必须是 `null` 或可解析的 ISO 字符串；否则 400。
- 所有响应 `cache-control: private, no-store`。
- bootstrap：按 `user_id` 查询 `study_room_states`；有行返回 `{ user:{id,name,picture}, profile, state, updatedAt }`，无行返回 `profile/state/updatedAt` 为 `null`。
- state：读取请求体（上限 1 MiB，流式读取并在超限时 cancel），校验 `profile`、`state`、`baseUpdatedAt`。
- `baseUpdatedAt === null` 插入；主键冲突（`23505`）读当前行返回 409 `conflict`。
- 非空：`update(...).eq('user_id', user.user_id).eq('updated_at', baseUpdatedAt)`；未命中读当前行返回 409；成功返回服务端新 `updatedAt`。
- 数据库错误返回 `state_unavailable` / `write_result_unknown`，不返回原始错误。
- 字段限制：
  - nickname ≤ 64 UTF-8 bytes；avatar ≤ 200000 字符且为空 / `https://` / `data:image/`；joinedAt 为 `YYYY-MM-DD` 或空。
  - checkins ≤ 4000；plans ≤ 500；docs ≤ 500；todos ≤ 2000；focus_sessions ≤ 20000。
  - 每项按现有类型校验；`mood` 可选且 ≤ 50 字符；非法项整包拒绝（不要静默过滤）。
- 不信任请求中的 `user_id`；即使 body 带了其他 user_id 也必须忽略。

- [ ] **Step 4: 写 `dev/fake-supabase.mjs`**

实现 `createFakeSupabase()`：

- 内存 `Map<userId, row>`。
- `from('study_room_states')` 返回链式对象，支持：
  - `.select(columns).eq('user_id', id).maybeSingle()`
  - `.insert(row).select(columns).single()`
  - `.update(patch).eq('user_id', id).eq('updated_at', ts).select(columns).maybeSingle()`
- 返回 `{ data, error }`；重复插入返回 `{ error: { code: '23505' } }`。
- 提供 `seed(userId, row)`、`rows()` 方便测试。

- [ ] **Step 5: 写 `dev/function-local.mjs`**

Node HTTP 服务，监听 8000：

- 读取请求体；构造 `Request`。
- 注入测试用户上下文（base64url JSON）：`user_id: 'fixture-user'`、`name: '测试同学'`、`picture: ''`、`site_id/host_id: 'fixture'`、`session_expires_at: 未来时间`。
- 支持 `cookie: fixture=anonymous` 时不注入身份，用于浏览器测试 401 登录页。
- 调用 `handleStudyRoom({ request, supabase: createFakeSupabase() })`，把响应写回。
- 启动时打印 URL；不打印任何敏感信息。

- [ ] **Step 6: 写 handler 测试**

`tests/functions/handler.test.ts`，文件头加 `// @vitest-environment node`。覆盖：

1. 无用户上下文 → 401 `login_required`。
2. 首次 bootstrap → `profile/state/updatedAt` 为 null。
3. 首次 PUT → 200 并写入。
4. 再次 bootstrap → 返回写入数据。
5. 正确 baseUpdatedAt 更新 → 200。
6. 过期 baseUpdatedAt → 409 `conflict` 且带 current。
7. 非法 JSON / 非法数组 → 400。
8. 超过 1 MiB → 413。
9. 重复插入（并发首次写）→ 409。
10. body 伪造 `user_id` 不能改变实际写入用户。
11. 未知 action → 404；错误方法 → 405；非 JSON content-type → 415。
12. 非法 baseUpdatedAt → 400。

测试用 `new Request('http://local/functions/v1/app?action=...')`；用户上下文用 `Buffer.from(JSON.stringify(...)).toString('base64url')`。

- [ ] **Step 7: 运行测试**

```bash
cd /e/projects/study-room
pnpm test -- tests/functions/handler.test.ts
```

预期全绿。

---

## Task 2: 前端同步核心与登录门禁（Agent B）

**Files:**
- Create: `src/api/study-room-sync.ts`
- Create: `src/session/session-state.ts`
- Create: `src/session/session-gate.ts`
- Create: `src/lib/profile-state.ts`
- Modify: `src/lib/local-user.ts`
- Modify: `src/lib/backup.ts`
- Modify: `src/views/studyRoom/study-room-state-store.ts`
- Modify: `src/App.vue`
- Create: `src/views/auth/LoginView.vue`
- Create: `src/views/auth/SessionGate.vue`
- Create: `src/views/auth/MigrationDialog.vue`
- Create: `src/views/auth/SyncConflictDialog.vue`
- Create: `src/api/__tests__/study-room-sync.test.ts`
- Modify: `src/views/studyRoom/__tests__/study-room-state.test.ts`

**Interfaces:**
- `bootstrapStudyRoom(): Promise<{ user, profile, state, updatedAt }>`
- `saveStudyRoom({ profile, state, baseUpdatedAt }): Promise<{ profile, state, updatedAt }>`
- `bootstrapSession()`, `resolveMigration('import'|'empty')`, `logoutLocal()`
- `hydrateStudyRoom(...)`, `scheduleSaveStudyRoom()`, `flushStudyRoom()`, `retrySync()`
- `useStudyRoomState()` 返回 `{ state, loaded, loading, error, syncStatus, conflict }`

- [ ] **Step 1: 写同步 API**

`src/api/study-room-sync.ts`：

- `AccountInfo`、`CloudProfile`、`CloudSnapshot`、`BootstrapData` 类型。
- `SyncApiError extends Error { code; status; current? }`。
- `requestJson` 使用 `fetch('/functions/v1/app?action=...', { credentials:'same-origin' })`。
- 校验 `content-type`、JSON、成功响应形状。
- 401/403 抛出 `SyncApiError`；409 解析 `current`；网络错误 `network_error`；5xx `service_unavailable`。
- `bootstrapStudyRoom()` 校验 `user.id/name/picture`，profile/state/updatedAt 允许 null。
- `saveStudyRoom()` 提交 `{ profile, state, baseUpdatedAt }`。
- 不自动重放 PUT。

- [ ] **Step 2: 写 profile 状态模块**

`src/lib/profile-state.ts`：

```ts
import { reactive } from 'vue';

import defaultAvatar from '#/assets/defaultUserAvatar.png';

export interface LocalProfile {
  nickname: string;
  avatar: string;
  joinedAt: string;
}

const today = new Date().toISOString().slice(0, 10);

export const profile = reactive<LocalProfile>({
  nickname: '学习者',
  avatar: defaultAvatar,
  joinedAt: today,
});

export function setProfile(next: LocalProfile): void { ... }
export function resetProfile(): void { ... }
export function profilePayload(): LocalProfile { ... }
```

- [ ] **Step 3: 改造 `local-user.ts`**

- 删除 localStorage 读写；改为读写 `profile-state`。
- `useLocalUser()` 返回 `{ profile }`。
- `saveLocalUser(patch)`：写 profile 并调用 `scheduleSaveStudyRoom()`；昵称按 UTF-8 字节校验 ≤ 64，超长抛错/提示。
- `sanitizeAvatar(value)`：允许空、`https://`、`data:image/`；本机 `/assets/...` 或 `/src/assets/...` 默认头像转为空字符串；其他值转为空。
- `applyQoderUser(user)`：若昵称为空或默认，设置 Qoder name；若头像为空，设置 Qoder picture（仅 https）；joinedAt 保持已有或今天。
- `fileToAvatarDataUrl` 保留，输出 `data:image/jpeg`。
- `profilePayload()` 返回 sanitize 后的 profile，保证服务端不会因默认头像路径拒绝。

- [ ] **Step 4: 写 session 状态与门禁**

`src/session/session-state.ts`：

```ts
export type SessionStatus = 'loading' | 'unauthenticated' | 'forbidden' | 'error' | 'ready';
export const sessionStatus = ref<SessionStatus>('loading');
export const account = ref<AccountInfo | null>(null);
export const sessionError = ref('');
export const locked = ref(localStorage.getItem(LOCK_KEY) === '1');
export function setSession(...)
export function clearSession()
export function lockLocalSession()
export function unlockLocalSession()
export function loginUrl(): string
```

锁标记用 `localStorage`，并监听 `storage` 事件：任一标签页退出后，其他标签页也回到未登录状态。`unlockLocalSession()` 清除锁后必须重新 `bootstrapSession()` 或跳转登录地址，不能只改内存状态。

`loginUrl()`：

```ts
const returnPath = `${window.location.pathname}${window.location.search}`;
return `/__qoder_auth/start?return_path=${encodeURIComponent(returnPath)}`;
```

`src/session/session-gate.ts`：

- `bootstrapSession()`：
  - 若 `locked` → `unauthenticated`。
  - `bootstrapStudyRoom()`。
  - 401 → unauthenticated；403 → forbidden；其他 → error（显示重试，不渲染缓存数据）。
  - 成功：设置 account；读取 `cache:v1`。
  - 缓存 userId 不匹配 → 清缓存。
  - 缓存匹配且 `pending`：
    - 云端无数据，或 `cache.baseUpdatedAt === cloud.updatedAt` → 用缓存 hydrate，立即推送；成功后清 pending。
    - 云端已更新 → 用缓存 hydrate，保存云端快照为冲突，显示冲突弹窗；不得静默丢弃本地修改。
  - 无 pending：按云端/空状态 hydrate。
  - 若 cloud.state 为 null 且有旧键且该用户未做迁移决定 → `migrationNeeded = true`。
  - 云端有数据时归档旧键到用户专属备份，不直接删除。
- `hydrateStudyRoom` 接收 `pending` 参数；只有推送成功或用户选择使用云端后才清 pending。
- `resolveMigration(kind)`：
  - import：读取并 sanitize 旧 state/profile，`hydrateStudyRoom({ userId, profile, state, updatedAt: null, pending: true })`，`pushInitialState()`；成功后归档旧键到用户专属备份，设置 `migrated=imported`。
  - empty：清空 state/profile（Qoder 资料），`pushInitialState()`；成功后归档旧键，设置 `migrated=empty`。
  - 失败保留弹窗并显示错误；不得提前删除旧键。
- `logoutLocal()`：清缓存、旧键、`qingyan-study-room:pomodoro:v1`、profile；`lockLocalSession()`；`window.location.assign('/')`。
- `migrated` 决定键按 `userId` 隔离。
- `retryBootstrap()`。

- [ ] **Step 5: 改造状态 store**

`src/views/studyRoom/study-room-state-store.ts`：

- 保留 `state`、`loaded`、`loading`、`error`、`useStudyRoomState` 兼容现有组件。
- 新增 `syncStatus`、`conflict`、`userId`、`updatedAt`。
- `hydrateStudyRoom({ userId, profile, state, updatedAt, pending })`：写入 refs，`loaded=true`；只有 `pending=false` 时才清缓存 pending。
- 维护 `updatedAt` 作为下一次 PUT 的 `baseUpdatedAt`；保存成功、使用云端、迁移成功后都更新它，避免下一次必然 409。
- `generation`：每次 `scheduleSaveStudyRoom()` 递增；响应返回时若 generation 落后，不得把 `syncStatus` 置为 synced，也不得弹过期冲突。
- `inFlight` / `queued`：单飞队列，同一时间只发一个 PUT；保存中再有修改，当前请求完成后按最新快照再发一次。
- `scheduleSaveStudyRoom()`：立即写缓存（userId/profile/state/updatedAt/pending/baseUpdatedAt），800ms 防抖 `pushStudyRoom()`。
- `pushStudyRoom()`：
  - 无 userId/loaded 直接返回；已有 inFlight 时设置 queued 并返回。
  - 序列化前检查 > 900 KiB → `error='内容过大，无法同步'`，`syncStatus='error'`。
  - 调 `saveStudyRoom`。
  - 成功：更新 updatedAt、缓存 pending=false、`syncStatus='synced'`；若 generation 已变，继续推送。
  - 409：`conflict=current`，`syncStatus='conflict'`。
  - 401：`clearSession()`，回到登录页。
  - 403：`clearSession()`，显示无权限。
  - 5xx/网络：`syncStatus='error'`，保留缓存 pending；标记 `unknownOutcome=true`。
- `pushInitialState()`：`conflict=null`，`updatedAt=null`，强制 PUT base null；使用单飞队列。
- `retrySync()`：
  - 若 `unknownOutcome`，先 `bootstrapStudyRoom()` 对账：云端等于本地 → synced；云端 base 未变 → 重推；云端已变 → 冲突；401/403 → 会话状态。
  - 若只是普通失败，重推；仍走单飞队列。
- `resolveConflictUseCloud()`：用 conflict 覆盖 state/profile，更新 updatedAt，清 pending，`syncStatus='synced'`。
- `resolveConflictKeepLocal()`：以 conflict.updatedAt 作为新 base 重新 push。
- `export/import` 保留；import 后标记 pending，`importBackup` 必须 `await flushStudyRoom()` 后才允许页面刷新。
- `hasLegacyLocalData()`、`readLegacyLocalData()`、`archiveLegacyLocalData(userId)`、`MIGRATION_DECISION_KEY(userId)`。
- 移除跨标签 storage 同步（云端为权威）；保留 `beforeunload` flush，但不承诺关闭瞬间写入成功。
- `loadStudyRoomState()` 改为“返回当前 state，不发起网络请求”，保持 `index.vue` 兼容。
- `resetForLogout()`：清空 refs、缓存、pending、冲突。

- [ ] **Step 6: 写 LoginView / SessionGate / 迁移 / 冲突组件**

- `LoginView.vue`：全屏雨林背景、玻璃卡片、品牌、`loginUrl()` 登录按钮；若 `locked` 显示“继续使用当前 Qoder 账号”；点击时 `unlockLocalSession()`。
- `SessionGate.vue`：按 `sessionStatus` 渲染 loading / LoginView / forbidden / error / MigrationDialog / slot；ready 时在 slot 外渲染 `SyncConflictDialog`。
- `MigrationDialog.vue`：全屏遮罩，显示旧数据条数；两个按钮“导入本机数据”“从空数据开始”；loading/error；不可关闭。
- `SyncConflictDialog.vue`：显示云端更新时间；两个按钮“使用云端”“保留本地并覆盖”；loading/error；不可关闭。
- `App.vue` 改为 `<SessionGate><router-view /></SessionGate>`。
- 样式与现有自习室暗色玻璃一致；移动端卡片宽度 `min(440px, 92vw)`。

- [ ] **Step 7: 写前端测试**

- `study-room-sync.test.ts`：mock `fetch`，覆盖 bootstrap 成功/401/403、save 成功/409/网络错误、响应形状非法。
- `study-room-state.test.ts`：测试 hydrate、pending 恢复、baseUpdatedAt 更新、单飞队列、generation 乱序、冲突解决、迁移读取、头像 sanitize、导出/导入；用 `vi.stubGlobal('fetch', ...)`。
- 现有 `study-room-utils.test.ts` 保持不变。
- 增加用例：保存中返回 401/403；伪造 user_id 不影响本地 userId；退出后 pomodoro 键被清除。

- [ ] **Step 8: 运行**

```bash
pnpm typecheck
pnpm test
```

预期通过（C 尚未改 UI 时，RoomTopBar/StudyHome 仍可能引用旧接口；B 完成后先记录，主 Agent 集成时统一修复）。

---

## Task 3: UI 集成（Agent C，B 完成后）

**Files:**
- Modify: `src/views/studyRoom/RoomTopBar.vue`
- Modify: `src/views/studyRoom/StudyHome.vue`
- Modify: `src/views/studyRoom/index.vue`
- Modify: `vite.config.ts`（本地 Function 代理）
- Modify: `README.md`
- Verify: `src/lib/backup.ts`（导入必须 await 云端保存）

- [ ] **Step 1: RoomTopBar 账号菜单**

- 保留现有导航、场景、白噪音。
- 头像使用 `profile.avatar || account.picture || defaultAvatar`，加 `referrerpolicy="no-referrer"`。
- 点击头像打开菜单：
  - Qoder 名称/头像。
  - 同步状态：已同步 / 同步中 / 同步失败；失败时“立即同步”。
  - “退出并清除本机数据”（`ElMessageBox.confirm` 二次确认，调用 `logoutLocal()`）。
- 点击遮罩关闭菜单；支持 Escape。
- 移动端菜单位于头像下方，不超出视口。

- [ ] **Step 2: StudyHome 账号化**

- 资料卡文案改为“已登录 · 数据自动同步”。
- 昵称 fallback `account.name`；头像 fallback `account.picture`。
- 保留编辑资料、导出、导入；`importBackup` 改为 async，内部 `await flushStudyRoom()` 成功后才返回；StudyHome 等待成功后再刷新，不能用固定 400ms 定时。
- 头像 `<img>` 加 `referrerpolicy="no-referrer"`。
- 移除“本地模式”文案。
- 加入同步状态/重试入口（可从 RoomTopBar 复用 store）。

- [ ] **Step 3: index.vue**

- 删除 `loadStudyRoomState()` 的 onMounted 调用（SessionGate 已注入）；保留 `flushStudyRoom()` onBeforeUnmount。
- 其他页签/样式不动。

- [ ] **Step 4: Vite 本地代理**

`vite.config.ts` 增加：

```ts
server: {
  host: '127.0.0.1',
  port: 5173,
  proxy: {
    '/functions/v1/app': 'http://127.0.0.1:8000',
  },
},
```

- [ ] **Step 5: README**

在现有 README 增加登录、云端同步、迁移、部署镜像说明；不要写敏感 ID。

- [ ] **Step 6: 静态检查**

```bash
grep -rnE "@qc-student|#/api|#/store|learningSpace|AnnouncementHub|ChatRoom" src || echo none
pnpm typecheck
```

---

## Task 4: 集成与本地测试（主 Agent）

- [ ] **Step 1: 全量检查**

```bash
cd /e/projects/study-room
pnpm typecheck
pnpm test
pnpm build
```

- [ ] **Step 2: 启动本地 Function fixture**

```bash
node dev/function-local.mjs
pnpm dev
```

- [ ] **Step 3: 浏览器测试（Playwright / browser-use）**

1. 未登录：设置 `fixture=anonymous` cookie 或访问线上，确认登录页与 `/__qoder_auth/start` 链接；不能只靠停掉 fixture（那样是 network error，不是 401）。
2. 登录 fixture：应用进入；迁移弹窗出现（若种了旧数据）；导入后云端有数据。
3. 修改打卡/计划/文档/待办/番茄钟，刷新后数据恢复。
4. 两个标签页同时修改，确认冲突弹窗。
5. 退出登录：缓存清除、回到登录页。
6. 移动端 375px：登录页、迁移弹窗、账号菜单、五个页签无横向溢出。
7. Console/Network：无未捕获异常；无多余外部请求。

- [ ] **Step 4: 修复集成问题**

优先修导入风格、循环依赖、SessionGate 重复请求、状态未 hydrate。

---

## Task 5: 云端数据库与发布（主 Agent）

- [ ] **Step 1: 启用后端**

```text
ensure_backend({
  siteId: "01a16c59-8bb2-7b41-9c62-39d6e1c9c248",
  requestId: "<UUID>",
  capabilities: ["database", "functions"]
})
```

轮询 `get_operation`，再 `get_backend` 确认 `database`/`functions` ready。

- [ ] **Step 2: 读取数据库状态**

```text
get_database({ siteId: "01a16c59-8bb2-7b41-9c62-39d6e1c9c248" })
```

记录 `schema_version`、`schema_fingerprint`。`snapshotRevision` 是 `list_database_tables` 的参数，不要传给 `get_database`。

- [ ] **Step 3: 创建并应用迁移**

SQL：

```sql
CREATE TABLE app.study_room_states (
  user_id text PRIMARY KEY,
  profile jsonb NOT NULL,
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL
);
```

accessPolicies：

```json
[
  {
    "table": "study_room_states",
    "principal": "anonymous",
    "actions": ["select", "insert", "update"],
    "template": "public"
  }
]
```

调用 `create_database_migration`，必须带 `clientMigrationId`（新 UUID）、`expectedSchemaVersion`、`expectedSchemaFingerprint`；检查 normalized SQL/policies。再调用 `apply_database_migration`，带 `migrationId`、新 `requestId`、`expectedRevision`、`expectedSchemaVersion`、`expectedSchemaFingerprint`、`sqlSha256`、`confirm: true`，轮询成功，`get_database` 验证表和版本。

- [ ] **Step 4: 同步部署镜像**

```bash
rm -rf /e/projects/qc-student/artifacts/study-room-site/dist
cp -r /e/projects/study-room/dist /e/projects/qc-student/artifacts/study-room-site/dist
rm -rf /e/projects/qc-student/artifacts/study-room-site/functions
cp -r /e/projects/study-room/functions /e/projects/qc-student/artifacts/study-room-site/functions
```

- [ ] **Step 5: 准备新版本**

```text
prepare_site({
  actionId: "<new UUID>",
  projectRoot: "E:\\projects\\qc-student\\artifacts\\study-room-site",
  webDirectory: "dist",
  functionDirectory: "functions",
  databaseAccess: "read_write",
  requiredSchemaVersion: <actual integer>,
  spa: true,
  projectId: "01a16c59-8bb1-79be-89dc-6ea0c0f8839f"
})
```

检查 `descriptorStatus`；用同一 action 重试 pending。

- [ ] **Step 6: 发布**

`publish_site({ actionId })`；轮询 `get_publish_status` 直到 `published: true`。

- [ ] **Step 7: 改为公开访问**

先 `get_access_policy({ siteId })` 获取当前 mode/revision，并确认 `available_modes` 包含 `public`、需要 `confirmPublic`；再：

```text
update_access_policy({
  siteId: "01a16c59-8bb2-7b41-9c62-39d6e1c9c248",
  requestId: "<UUID>",
  mode: "public",
  confirmPublic: true,
  expectedRevision: "<revision>"
})
```

- [ ] **Step 8: 线上验证**

- 浏览器匿名访问 `https://qingyan-study-room-j8vzdjdlheu.qoder.website/`：应显示登录页 200。
- `GET /functions/v1/app?action=bootstrap` 未登录：401 JSON。
- 登录按钮 href 指向 `/__qoder_auth/start?return_path=...`。
- 真实 Qoder 登录需要用户完成；说明这一项未自动验证。
- `show_publish_confirmation` 收尾。

---

## 自检

- 规格覆盖：登录、迁移、同步、冲突、退出、公开访问、Function 级隔离、测试、部署均有任务。
- 并行冲突：A 后端独立；B 核心独立；C 只改 UI/配置；主 Agent 负责部署。
- 类型一致：`CloudProfile`/`StudyRoomState`/`BootstrapData` 在 API、session、store 中一致。
- 无占位符：关键后端与同步逻辑给出接口和校验要求；UI 改造点明确。
- 安全边界：明确匿名授权 + Function 隔离，并记录用户已接受公开场景。
