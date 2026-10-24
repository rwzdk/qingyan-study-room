# 清砚自习室

## 当前线上版本

线上使用**纯前端静态版**，已公开访问：

https://qingyan-study-room-j8vzdjdlheu.qoder.website

- 不需要登录，打开即用。
- 打卡、计划、文档、待办、番茄记录和资料保存在浏览器 localStorage。
- 数据只在当前浏览器，换设备或清除浏览器数据会丢失；请在主页使用“导出数据”备份。
- 当前源码中的 Qoder 登录与云端同步功能保留，但因 Qoder Sites 后端配额为 0，未发布到线上。

## 登录（未发布的云端方案）

- 只支持 Qoder 账号登录，没有站内注册、密码或找回密码。
- 未登录时只显示登录页，登录按钮跳转 `/__qoder_auth/start`。
- 站点公开后，任何 Qoder 用户都可以登录，各自一份云端数据，互不可见。
- 登录身份由 Qoder Sites Function 从请求上下文读取，浏览器提交的身份字段不会被信任。

## 云端同步

- 数据表为 `app.study_room_states`，每个用户一行，通过 `/functions/v1/app` 读写。
- 编辑后立即写本机缓存，约 800ms 防抖后提交云端；同一时间只有一个写入请求。
- 顶栏头像菜单和主页资料卡会显示同步状态：等待同步、同步中、已同步、同步失败、数据冲突。
- 同步失败时菜单和主页提供“立即同步”；网络错误或 503 会先与云端对账，不盲目重放未知结果的写入。
- 两个标签页或两台设备同时修改会触发冲突弹窗，必须选择“使用云端”或“保留本地并覆盖”，不会静默丢弃修改。
- 请求体上限 1 MiB，前端在提交前检查 900 KiB；头像只接受空、`https://` 或 `data:image/`。

## 首次登录迁移

旧版本把数据存在浏览器 localStorage。首次登录且云端没有数据时，会弹出迁移选择：

- **导入本机数据**：把旧版本地状态写入云端，成功后将旧数据归档到用户专属备份键。
- **从空数据开始**：以 Qoder 资料和空状态初始化云端，旧数据同样归档备份。

迁移失败会保留弹窗和旧数据，可重试；云端已有数据时不会弹窗，旧数据只归档、不覆盖云端。

## 退出登录

顶栏头像菜单中的“退出并清除本机数据”需要二次确认。确认后会清除：

- 本机缓存和待同步标记
- 旧版 state / profile 活动键
- 番茄钟计时状态
- 本机锁标记，并回到登录页

场景偏好保留在本机。退出只清除本机数据，Qoder 登录会话由 Qoder 管理；其他标签页会通过锁标记回到登录页。

## 本地开发

```bash
pnpm install

# 终端 1：本地 Function fixture（假 Supabase，监听 8000）
node dev/function-local.mjs

# 终端 2：前端开发服务器（监听 5173）
pnpm dev
```

`vite.config.ts` 已把 `/functions/v1/app` 代理到 `http://127.0.0.1:8000`。

本地 fixture 默认注入测试用户；给请求带上 `fixture=anonymous` Cookie 可模拟未登录，验证登录页。

## 检查

```bash
pnpm typecheck
pnpm test
pnpm build
```

## 本机数据键

- 云端缓存：`qingyan-study-room:cache:v1`
- 旧版状态 / 资料：`qingyan-study-room:state:v1`、`qingyan-study-room:profile:v1`（迁移后归档）
- 旧数据归档：`qingyan-study-room:legacy-backup:v1:<userId>`
- 迁移决定：`qingyan-study-room:migrated:v1:<userId>`
- 退出锁标记：`qingyan-study-room:locked:v1`
- 场景：`qingyan-study-room:scene:v1`
- 番茄钟：`qingyan-study-room:pomodoro:v1`（退出登录时清除）

主页保留导出/导入 JSON；导入会等待云端保存完成后才刷新页面。

## 部署前提（当前阻塞）

登录与云端同步依赖 Qoder Sites 的 Functions + Database。当前账户调用 `ensure_backend` 返回：

```text
sites_quota_exceeded
resource: backend_sites
used: 0, limit: 0
```

需要先开通或升级 Qoder Sites 后端配额（参考 `https://qoder.com/pricing`），再执行数据库迁移与发布。配额可用前，线上仍是旧版静态站点，尚未切换为登录版，也没有改为公开访问。

## 部署与公开访问

`pnpm build` 后得到 `dist/`，通过 Qoder Sites 以 SPA 方式托管。当前 Qoder 会话工作区是 `E:\projects\qc-student`，Sites 要求站点目录位于工作区内，因此发布前先把构建产物和 Function 同步到部署镜像：

```text
E:\projects\qc-student\artifacts\study-room-site\
  dist\        # 来自本项目 dist/
  functions\   # 来自本项目 functions/
```

再以该目录为 `projectRoot`、`webDirectory=dist`、`functionDirectory=functions`、`spa=true`、`databaseAccess=read_write` 发布，并确保数据库迁移已应用。

站点默认私有；需要公开时在 Sites 访问策略中改为 `public` 并确认风险。公开后：

- 匿名访问应看到登录页（HTTP 200）。
- 未登录调用 `GET /functions/v1/app?action=bootstrap` 应返回 401 JSON。
- 每个 Qoder 用户登录后只能读写自己的数据（由 Function 强制隔离）。

数据库访问策略只授予 `select/insert/update`，不授予 `delete`；Function 级隔离不是生产级 RLS，公开场景请勿存放敏感个人信息。真实 Qoder 登录需要用户本人在浏览器完成。
