# 清砚自习室登录与云端同步设计

日期：2026-10-24
状态：已确认（用户授权公开访问与 Function 级隔离）

## 背景

独立版自习室当前是纯前端应用，数据只存在浏览器 localStorage。用户要求增加登录、云端同步，并把站点部署到公网供访问。

## 决策

- 使用 Qoder 账号登录，不实现站内邮箱/密码。
- 强制登录：未登录只能看到登录页，登录后才能进入自习室。
- 数据按 Qoder `user_id` 存云端；站点公开访问，任何 Qoder 用户登录后各自一份数据。
- 首次登录且云端无数据时，弹窗选择“导入本机数据”或“从空数据开始”。
- 接受 Qoder Sites 的 Function 级隔离：数据库层仍是匿名授权，隔离由 Function 强制，不是生产级 RLS。公开场景不存敏感个人信息。
- 退出登录：清除本机缓存并回到登录页；Qoder 会话由 Qoder 管理。

## 非目标

- 站内注册、密码、找回密码、邮箱验证。
- 团队空间、共享自习数据、管理员后台。
- 离线编辑；断网时显示错误页与重试，不渲染云端数据。
- 场景偏好跨设备同步；场景仍存本机。

## 架构

```
浏览器
  └─ Vue SPA
      ├─ SessionGate（登录门禁 / 错误页 / 迁移弹窗 / 冲突弹窗）
      ├─ LoginView（Qoder 账号登录）
      ├─ 自习室页面（现有五个页签）
      └─ 云端同步层
          ├─ study-room-sync API（/functions/v1/app）
          ├─ 本地缓存 + 待同步标记
          └─ 冲突检测

Qoder Sites Gateway
  └─ Function（Deno，edge）
      ├─ requireUser(request)（Qoder 登录身份）
      ├─ 校验请求体
      └─ Supabase 适配器
          └─ app.study_room_states（每用户一行）
```

## 登录流程

1. 应用启动，`SessionGate` 调用 `GET /functions/v1/app?action=bootstrap`。
2. 401：显示 `LoginView`，按钮跳转 `/__qoder_auth/start?return_path=<当前路径>`。
3. 403：显示“无访问权限”，提供重试/切换账号入口。
4. 网络/5xx：显示错误页与重试；不渲染缓存数据，避免共享设备泄露。
5. 200：拿到 `{ user, profile, state, updatedAt }`，初始化自习室。
6. 登录页背景使用雨林场景图，保持与自习室一致的视觉。

## 数据模型

```sql
CREATE TABLE app.study_room_states (
  user_id text PRIMARY KEY,
  profile jsonb NOT NULL,
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL
);
```

访问策略（Function 使用匿名 key，已完成有限功能范围确认）：

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

不授予 delete。

`profile`：

```ts
interface CloudProfile {
  nickname: string;   // <= 64 UTF-8 bytes
  avatar: string;     // 空、https:// 或 data:image/...；空时使用 Qoder 头像
  joinedAt: string;   // YYYY-MM-DD
}
```

`state` 沿用现有 `StudyRoomState`（checkins/plans/docs/todos/focus_sessions）。

## Function API

所有响应 `cache-control: private, no-store`。

### GET `/functions/v1/app?action=bootstrap`

- `requireUser(request)`；浏览器提交的身份字段一律忽略。
- 按 `user.user_id` 查询一行。
- 有数据：返回 `{ user: {id,name,picture}, profile, state, updatedAt }`。
- 无数据：返回 `{ user, profile: null, state: null, updatedAt: null }`。
- 数据库失败：`503 { error: "state_unavailable" }`。

### PUT `/functions/v1/app?action=state`

请求：

```json
{
  "profile": { "nickname": "...", "avatar": "...", "joinedAt": "2026-10-24" },
  "state": { "checkins": [], "plans": [], "docs": [], "todos": [], "focus_sessions": [] },
  "baseUpdatedAt": "2026-10-24T05:00:00.000Z"
}
```

行为：

- `baseUpdatedAt === null`：插入；若主键冲突，返回 `409 { error:"conflict", current }`。
- 非空：`update(...).eq("user_id", user.user_id).eq("updated_at", baseUpdatedAt)`；未命中时读取当前行，返回 `409 { error:"conflict", current }`。
- 成功：返回 `{ profile, state, updatedAt }`，`updatedAt` 由服务端生成。
- 请求体上限 1 MiB；校验 JSON 类型、数组形状、字段长度、数组条数。
- 数据库异常：`503 { error:"write_result_unknown" }`，客户端重新 bootstrap 核对，不自动重放。

错误码：

| HTTP | code | 含义 |
| --- | --- | --- |
| 400/413 | `invalid_input` | 请求体非法或过大 |
| 401 | `login_required` | 未登录 |
| 403 | `invalid_user_context` | 身份上下文无效 |
| 409 | `conflict` | 并发更新 |
| 503 | `state_unavailable` / `write_result_unknown` | 数据库不可用或写结果未知 |

## 前端状态

### SessionGate

状态：`loading | unauthenticated | forbidden | error | ready`。

- `ready` 前不渲染自习室。
- 启动时读取本地缓存；缓存必须匹配当前 `userId`，否则丢弃。
- 云端有数据：使用云端；清理旧版本地键。
- 云端无数据且存在旧版本地数据：显示迁移弹窗。
- 云端无数据且无旧数据：使用空状态，首次修改时插入。

### 本地缓存

键：`qingyan-study-room:cache:v1`

```ts
interface LocalCache {
  userId: string;
  profile: CloudProfile;
  state: StudyRoomState;
  updatedAt: string | null;
  pending: boolean;
  baseUpdatedAt: string | null;
}
```

- 每次修改立即写缓存，标记 `pending`。
- 800ms 防抖后 PUT；同一时间只允许一个 PUT，后续修改排队。
- 每次编辑递增 `generation`；响应返回后若 generation 已变化，不标记已同步，继续推送。
- 成功后清 `pending`，更新 `updatedAt`，下一次 PUT 以新的 `updatedAt` 作为 `baseUpdatedAt`。
- 失败保留 `pending`，顶部显示“同步失败”，提供重试。
- 下次启动读取缓存：仅当 `cache.userId` 等于当前用户时才使用。若 `pending` 且 `cache.baseUpdatedAt` 等于云端 `updatedAt`（或云端无数据），自动用缓存重新推送；若云端已更新，进入冲突处理，不静默丢弃本地修改。
- `retrySync` 先 bootstrap 与云端核对，再决定重推/冲突/已同步；不盲目重放未知写。

### 冲突

`409` 时保存云端快照，显示冲突弹窗：

- “使用云端”：用云端替换本地，清除 pending。
- “保留本地并覆盖”：用云端 `updatedAt` 作为新 `baseUpdatedAt` 重新 PUT。
- 冲突弹窗显示本机未同步状态与云端更新时间；任何保存响应都要按 generation 判断是否已过期。

### 并发与重试

- `pushStudyRoom` 使用单飞（in-flight）队列；保存中再次修改只标记 queued，当前请求完成后按最新快照再发一次。
- 较早请求的响应不得覆盖较新的本地编辑，也不得为过期快照弹冲突。
- 网络错误或 503 属于“写结果未知”：重试前先 bootstrap 对账；`write_rejected` 属于明确拒绝，修正输入后再重试。

### 迁移

旧键：`qingyan-study-room:state:v1`、`qingyan-study-room:profile:v1`。

- 迁移决定按用户隔离：`qingyan-study-room:migrated:v1:<userId>`。
- 云端无数据且旧键存在且该用户未做过迁移决定：显示全屏迁移弹窗。
- “导入本机数据”：写入云端，成功后把旧数据归档到 `qingyan-study-room:legacy-backup:v1:<userId>`，删除活动旧键，设置 `migrated = "imported"`。
- “从空数据开始”：写入空状态/Qoder 资料，成功后同样归档旧数据，设置 `migrated = "empty"`。
- 云端已有数据：不弹窗；把旧数据归档到用户专属备份键并删除活动旧键，避免下一个账号误导入。归档失败则保留旧键并记录错误，不阻塞登录。

### 退出登录

- 清除 `qingyan-study-room:cache:v1`、旧版 state/profile 键；保留场景键和计时器键。
- 写入 `sessionStorage` 锁标记 `qingyan-study-room:locked:v1`。
- 重新加载到登录页；登录按钮清除锁并跳转 `/__qoder_auth/start`。
- UI 文案：“退出并清除本机数据”，说明 Qoder 会话由 Qoder 管理。

## UI 改动

- 新增 `LoginView.vue`：雨林背景、玻璃卡片、品牌、登录按钮。
- 新增 `SessionGate.vue`：加载/登录/错误/迁移/冲突/正常六种视图。
- `RoomTopBar.vue`：恢复账号菜单，显示 Qoder 头像/昵称、同步状态、立即同步、退出登录。
- `StudyHome.vue`：资料卡改为“已登录 · 数据自动同步”；头像默认使用 Qoder 头像；保留导出/导入。
- `index.vue`：不再自行加载云端，由 SessionGate 注入；保留卸载时 flush。

## 文件结构

```
functions/
  index.ts          # Deno.serve(serveSite(handleStudyRoom))
  adapter.mjs       # 平台提供的数据库适配器，原样复制
  auth.mjs          # 平台提供的用户上下文读取，原样复制
  handler.mjs       # bootstrap / state 业务逻辑
dev/
  function-local.mjs    # 本地 Function fixture + 假 Supabase
  fake-supabase.mjs     # handler 测试共用
src/
  api/study-room-sync.ts
  session/session-gate.ts
  session/session-state.ts
  lib/profile-state.ts
  views/auth/LoginView.vue
  views/auth/SessionGate.vue
  views/auth/MigrationDialog.vue
  views/auth/SyncConflictDialog.vue
  views/studyRoom/study-room-state-store.ts   # 改造为云端同步
  views/studyRoom/index.vue
  views/studyRoom/RoomTopBar.vue
  views/studyRoom/StudyHome.vue
tests/
  functions/handler.test.ts
```

## 错误处理

- 401：清除会话并回到登录页。
- 403：无权限页。
- 409：冲突弹窗。
- 网络/5xx：保留 pending 缓存，显示同步失败与重试；重试前先 bootstrap 对账，不自动重放未知写。
- 请求体过大：客户端在提交前检查 JSON 字节数，超过 900 KiB 提示“内容过大，无法同步”。
- 头像只允许空、`https://` 或 `data:image/`；本机默认头像路径在提交前转为空字符串，由前端回退到 Qoder 头像/内置头像。昵称 ≤ 64 UTF-8 bytes，前端与 Function 都校验。
- 退出登录时清除 `qingyan-study-room:pomodoro:v1`，避免下一个账号继承上一个账号的计时状态。

## 测试

- 单元测试：同步 API 400/401/403/409/5xx、缓存 pending 恢复、冲突解决、迁移决策。
- Function 测试：401/403、首次插入、正常更新、冲突、非法输入、超限。
- 本地 fixture：假 Supabase + 注入测试用户上下文；Vite 代理 `/functions/v1/app`。
- 浏览器测试：登录门禁、迁移弹窗、导入本机数据、编辑后同步、刷新恢复、退出登录、移动端布局。
- 线上验证：公开访问登录页；未登录 Function 返回 401；真实 Qoder 登录由用户在浏览器完成；说明未自动验证的部分。

## 部署

1. 对现有 Site 调用 `ensure_backend`，能力 `database` + `functions`。
2. `get_database` 获取 schema version/fingerprint。
3. `create_database_migration` + `apply_database_migration`。
4. 将 `dist` 与 `functions` 同步到部署镜像目录。
5. `prepare_site`：复用现有 `projectId`，新 action，`functionDirectory: "functions"`，`databaseAccess: "read_write"`，`requiredSchemaVersion` 为实际版本。
6. `publish_site`，验证 `published: true`。
7. `get_access_policy` → `update_access_policy`：`mode: "public"`，`confirmPublic: true`。
8. 验证公开入口、登录页、401 响应；`show_publish_confirmation` 收尾。

## 风险与限制

- 数据库对匿名 principal 授予 select/insert/update，Function 级隔离不是生产级 RLS；公开访问已获用户确认。它无法阻止拥有数据库直连能力的越权读取/写入，也不能替代删除权限控制和配额管理。
- 数据库不授予 delete；如需“删除账号数据”，要另做受控操作，不在本次范围。
- Qoder 登录会话由平台管理，应用内“退出登录”只清除本机数据；别的标签页会通过本地锁标记同步回登录页。
- 真实 Qoder 登录无法在 CLI 浏览器自动完成，需要用户实际操作一次。
- 并发写为乐观锁，冲突需用户选择；不是实时协作。
- 站点公开后任何 Qoder 用户都可使用，Function 无邮箱验证/风控/限流；公开入口需要平台侧配额监控。
- `beforeunload` 中的异步保存不可靠；依赖 800ms 防抖与页面内同步状态，不承诺关闭页面瞬间的写入。

## 验收标准

- 未登录访问只显示登录页，按钮跳转 Qoder 登录。
- 登录后能读取/写入自己的云端数据，刷新后恢复。
- 首次登录迁移弹窗工作，导入后云端有数据。
- 两设备/两标签冲突时出现选择，不静默丢数据。
- 公开入口可访问；未登录 Function 返回 401。
- 现有五个页签、打卡、计划、文档、待办、番茄钟、场景、导出/导入不回归。
- `pnpm typecheck/test/build` 通过。
