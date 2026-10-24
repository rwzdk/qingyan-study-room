# 清砚自习室独立版设计

日期：2026-10-24
状态：已确认

## 背景

清砚学苑（`E:\projects\qc-student`）的自习室是一个 Vue 3 单页功能，原实现依赖学生登录、FastAPI 状态接口、公告、AI 聊天和错题复习模块。目标是把它拆成独立纯前端项目，放在 `E:\projects\study-room`，用浏览器本地存储持久化，并托管到 Qoder Sites。

## 目标

- 独立于 qc-student 运行，不请求任何原后端接口。
- 保留完整自习室体验：小岛 3D 打卡、专注室、计划、阅读、主页。
- 数据保存在当前浏览器 localStorage，支持导出/导入 JSON。
- 静态构建后发布到 Qoder Sites，得到可访问链接。

## 非目标

- 不做登录、账号体系、云端同步。
- 不做 AI 聊天、公告 Hub、错题复习、复习加强。
- 不做管理端、课程、学习空间等其他模块。
- 不自动提交或推送 Git。

## 技术栈

- Vue 3.5 + TypeScript + Vite
- Element Plus（弹窗、按钮、消息）
- Three.js（小岛 3D）
- lucide-vue-next（本地图标，不访问在线 Iconify API）
- vue-router（单路由 + query 页签）
- Vitest + jsdom（本地状态与工具函数测试）
- pnpm 包管理

## 架构

单页应用，路由只有 `/`。页签通过 `?tab=island|focus|plans|docs|home` 表达，默认 `island`。

```
浏览器
  └─ Vue 应用
      ├─ index.vue（场景、页签、全局暗色浮层样式）
      ├─ RoomTopBar（品牌、场景切换、页签、白噪音、本地用户）
      ├─ 五个页签组件
      └─ 本地数据层
          ├─ study-room-state-store（localStorage，防抖写）
          ├─ local-user（昵称/头像，localStorage）
          └─ study-room-store / scene（纯函数）
```

所有组件只依赖本地模块；无 HTTP 客户端、无鉴权 store、无服务端 SDK。

## 功能范围

| 模块 | 处理 |
| --- | --- |
| 小岛 3D 打卡（IslandCheckin + LearningIsland） | 保留 |
| 专注室（FocusRoom、FocusTimer、ImmersiveOverlay、LocalTodoPanel、AmbientSound） | 保留 |
| 计划（StudyPlans） | 保留 |
| 阅读（StudyDocs） | 保留 |
| 主页（StudyHome） | 保留统计；个人资料改为本地昵称 + 本地头像 |
| 场景切换（雨林/雪日/暖云） | 保留 |
| 公告 Hub | 移除 |
| AI 聊天（ChatRoom） | 移除 |
| 错题复习、复习加强 | 移除 |
| 登录、退出、个人中心跳转 | 移除 |
| 原后端 API | 全部移除 |

## 数据设计

类型与 qc-student 保持一致：

```ts
interface StudyRoomState {
  checkins: StudyRoomCheckin[];
  plans: StudyRoomPlan[];
  docs: StudyRoomDoc[];
  todos: StudyRoomTodo[];
  focus_sessions: StudyRoomFocusSession[];
}
```

- 存储键：`qingyan-study-room:state:v1`
- 写入：修改后 500ms 防抖；`beforeunload` / 组件卸载时 flush。
- 读取：启动时读取；JSON 损坏或类型不符时回退为空状态并清理坏数据。
- 多标签页：监听 `storage` 事件同步状态。
- 导出/导入：主页提供 JSON 导出与导入，导入前校验五个数组字段。
- 个人资料键：`qingyan-study-room:profile:v1`，字段 `nickname`、`avatar`（data URL）、`joinedAt`。
- 头像：本地选图后用 canvas 压缩为 256×256 JPEG data URL，避免撑爆 localStorage。

## 依赖替换

| 原依赖 | 替换 |
| --- | --- |
| `@qc-student/icons`（IconifyIcon） | 本地 `IconifyIcon.vue`，映射到 lucide-vue-next 组件 |
| `@qc-student/preferences` | 本地常量（默认头像） |
| `@qc-student/stores`（用户/权限） | 本地 `useLocalUser` |
| `#/api/study-room` | localStorage 状态层 |
| `#/api/student-http`、`#/api/request` | 删除 |
| `#/components/assistant/AnnouncementHub.vue` | 删除 |
| `#/views/learningSpace/*` | 删除 |

图标映射至少覆盖：arrow-left、book-open、calendar、calendar-check、chart-line-up、check、check-circle、chevron-down、circle-check、clock、file-text、flag、flame、github、leaf、list-checks、log-out、map-pin、maximize-2、message-circle、pause、pencil、play、plus、rotate-ccw、send、skip-forward、sparkles、target、timer、timer-reset、trash-2、trending-up、triangle-alert、user、volume-2、volume-x、x。`lucide:chart-line-up` 映射到 lucide 的 `ChartLine`。

## 资源

- 背景图：`public/images/study-room/{rain,snow,cloud}.webp`（约 300KB）。
- 默认头像：`src/assets/defaultUserAvatar.png`。
- 白噪音：`ambient-audio.ts` 使用 Web Audio 实时合成，不加载 mp3/wav，不复制 `public/audio`。
- 不引用在线字体、在线图标或 Iconify API。

## 样式

- 复制 `study-room-extension.css`。
- 在 `src/style.css` 定义基础令牌：`--qc-ink`、`--qc-bar`、`--study-room-primary` 等。
- `index.vue` 已包含 Element Plus 浮层的暗色覆盖（Dialog/MessageBox/Select/Message），随文件复制。
- 保留现有移动端布局与响应式规则。

## 文件结构

```
study-room/
  index.html
  package.json
  tsconfig.json
  vite.config.ts
  vitest.config.ts
  README.md
  public/images/study-room/*.webp
  src/
    main.ts
    App.vue
    style.css
    assets/defaultUserAvatar.png
    router/index.ts
    components/IconifyIcon.vue
    lib/icons.ts
    lib/preferences.ts
    lib/storage.ts
    lib/local-user.ts
    views/studyRoom/
      index.vue
      RoomTopBar.vue
      TabErrorBoundary.vue
      AmbientSound.vue
      ambient-audio.ts
      FocusRoom.vue
      FocusTimer.vue
      ImmersiveOverlay.vue
      LocalTodoPanel.vue
      IslandCheckin.vue
      LearningIsland.vue
      StudyPlans.vue
      StudyDocs.vue
      StudyHome.vue
      study-room-extension.css
      study-room-scene.ts
      study-room-store.ts
      study-room-state-store.ts
      __tests__/study-room-state.test.ts
      __tests__/study-room-utils.test.ts
```

## 测试与验收

- `pnpm typecheck` 通过。
- `pnpm test` 通过（存储读写、坏数据回退、连续天数、场景解析）。
- `pnpm build` 通过，产物在 `dist/`。
- 浏览器实测：
  - 五个页签可切换，URL query 同步。
  - 打卡后刷新仍保留；计划/文档/待办增删改后刷新仍保留。
  - 番茄钟完成后累计到主页。
  - 昵称、头像修改后刷新仍保留。
  - 三种场景可切换，刷新后保留。
  - 白噪音开关不发起音频文件请求。
  - 移动端 375×812 无横向滚动、主要操作可点击。
  - Network 面板无 `/api`、无 `api.iconify.design`、无 qc-student 域名请求。
  - Console 无未捕获异常。

## 部署

- 构建：`pnpm build`，产物 `dist/`。
- 使用 Qoder Sites 的 `prepare_site` 上传草稿：
  - `projectRoot = E:\projects\study-room`
  - `webDirectory = dist`
  - `spa = true`
  - `displayName = 清砚自习室`
  - `slug = qingyan-study-room`
- 准备完成后调用 `publish_site`，再验证线上 URL。
- 不手写或修改生成的 `.qoder.site` 描述文件。

## 风险

- localStorage 是单浏览器数据，清理浏览器数据会丢失；导出/导入作为兜底。
- 上游 qc-student 后续改动不会自动同步。
- 去掉原有全局主题后，少数 Element Plus 浮层可能有细微视觉差异，需要在浏览器逐项核对。
- 3D 小岛在低端移动设备上可能掉帧；沿用原实现，不做额外优化。

## 验收标准

- 新项目可在 `E:\projects\study-room` 独立安装、启动、构建。
- 不依赖 qc-student 的任何文件或服务即可运行。
- 通过上述浏览器实测项。
- Qoder Sites 发布成功并可访问。
