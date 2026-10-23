# Electron GA4 Telemetry v0.3

## 正式依赖与 HTTPS 采集桥

通过 `pnpm add github:nexmoe/electron-ga4-telemetry#v0.3.0` 安装。下方保留 v0.3 原始桌面指标 API；新的主进程 HTTPS 采集桥和原生 gtag 命令接口见 [英文 README](README.md)。已有业务埋点的应用优先使用 `/gtag`，无需重新定义事件。

实测确认当前官方 gtag 会中止非 HTTP/HTTPS 文档的 GA4 采集。虚拟页面地址不能解决它。自定义协议应用应在主进程安装 `/transport`，在已有 preload 中安装 `/transport-preload`。库用独立、持久化的 HTTPS 采集页运行未改写的官方脚本，不迁移应用 origin 或已有存储。前后台状态来自可信应用窗口。

`gtag(...args)` 保留官方命令、嵌套电商参数和回调。`/renderer` 的推荐事件、隐私过滤、增强采集回退与桌面额外指标继续保留。桥接模式下的页面路由、滚动和链接由应用 DOM 适配器采集；表单和 HTML5 视频须使用显式标记，搜索词须主动批准。不能把这种适配写成所有网页、原生 OS 操作和 YouTube 场景均已自动验证。


基于 **Google 官方 `gtag.js`** 的 Electron 主进程 + Preload + Renderer 指标封装。仅需要 Web Data Stream 的 `G-...` Measurement ID，**不需要 API Secret**。

**新增：** 对齐 GA4 Web 推荐事件（含标准收入/电商 `items[]`）、可选增强型衡量回退、内置 `gtag(get)` 会话诊断。原生报表的接入与验收步骤见 [GA4 Web 预设指标指南](./docs/GA4-WEB-PRESETS.md)。

> 当前状态：TypeScript 静态编译和本地模拟测试通过。**尚未在真实 Electron 打包应用、`app://` / `file://`、真实 GA4 账号内完成端到端验证。** GA4 原生用户、会话、留存、来源和地理报表的准确性仍需测试。此仓库可作为固定版本的 GitHub 依赖使用，尚未发布 npm。

## 文件

- `src/main.ts`：匿名 ID 持久化、启动、日活、桌面会话、更新、窗口/崩溃、可选 CPU/内存采样、安装渠道。
- `src/preload.ts`：使用 `contextBridge` 安全暴露受限方法。
- `src/renderer.ts`：官方 gtag、PV、功能/下载/转化、自动点击/滚动、前台/实际交互时长、JS 错误、可选性能。
- `src/core.ts`：指标字段和 UTM 清洗、动态页面保护。
- `src/ga4-web.ts`：GA4 Web 标准事件参数与电商 items[] 安全校验。
- `examples/`：Electron Main / Preload / Renderer、React Router、Next App Router、Next Pages Router 示例。
- `docs/GA4-DASHBOARD.md`：报表指标定义、后台需要注册的自定义维度与指标。
- `docs/VALIDATION.md`：真正打包后必须验证的事项。
- `dist/`：已编译 CommonJS JS 和 `.d.ts` 文件。也可以复制 `src/` 到现有 TypeScript 工程，由 Vite/electron-vite/webpack 编译。
- `tests/`：离线 Node 模拟测试。`pnpm install && pnpm test` 将使用真实的 Electron TypeScript 定义编译代码。仓库还含离线 TypeScript stub，仅用于当前沙箱编译，不能代替 Electron 实机测试。

## 1. 接入示例

将 `src/` 复制进现有 Electron 项目。原项目如果已有 Preload，请**合并安装函数**，不要替换现有 IPC/安全逻辑。

**Main**，在 `app.whenReady()` 后创建窗口、加载页面前执行：

```ts
import { installMainTelemetry } from './telemetry/main';

const telemetryMain = installMainTelemetry(mainWindow, {
  enabled: userSettings.analyticsConsent, // 默认应为 false
  channel: 'stable',
  sampleResources: true,                  // 可选，每 5 分钟一次
  // initialCampaign: installerOrFirstOpenUrl, // 仅当前真实来源有 UTM 时提供
});
mainWindow.on('closed', telemetryMain.dispose);
```

**Preload**：

```ts
import { installTelemetryPreload } from './telemetry/preload';
installTelemetryPreload();
```

窗口应保持 `contextIsolation: true`、`nodeIntegration: false`；配置好你项目已有的 `preload` 路径。请勿在可导航到不可信网站的 BrowserWindow 暴露该桥。

**Renderer**：

```ts
import { ElectronGA4Telemetry } from './telemetry/renderer';

export const telemetry = new ElectronGA4Telemetry({
  measurementId: 'G-XXXXXXXXXX',
  virtualPageOrigin: 'https://desktop.yourdomain.com',
  enabled: userSettings.analyticsConsent, // 必须与 Main 偏好一致
  autoPageViews: true,
  routeMode: 'history', // HashRouter 则选 'hash'
  autoClicks: true,
  autoScroll: true,
  collectWebVitals: true,
  mapRoute(path) {
    if (path === '/') return 'home';
    if (path.startsWith('/downloads')) return 'downloads';
    if (/^\/videos\/[^/]+$/.test(path)) return 'videos/detail';
    if (path.startsWith('/settings')) return 'settings';
    return 'other'; // 不上报用户内容和动态 ID
  },
});

await telemetry.init();
telemetry.feature('video_download');
telemetry.download('started', 'mp4');
telemetry.download('completed', 'mp4', 2400);
telemetry.conversion('sign_up', { method: 'email' });
```

**页面埋点**：`autoPageViews: true` 会监听 `history.pushState`、`replaceState`、`popstate` 和 `hashchange`，默认将不确定的动态路径合并为 `section/detail`。复杂 SPA 建议提供上述 `mapRoute`，或设为 `false` 并使用 `examples/routers/` 提供的框架监听写法。切勿同时启用自动监听与手动路由 Hook；重复的路径已尽量去重，但最好只保留一个来源。

**点击埋点**：仅收集主动标注的元素，防止自动收集表单、输入框或用户数据：

```html
<button data-ga4-event="open_downloads" data-ga4-feature="downloads">下载</button>
```

**转化率**：调用 `telemetry.conversion('sign_up', ...)` 后，需要在 GA4 管理员将 `sign_up` 设置为 Key event；漏斗报告也需要在 GA4 Explore 自行配置。

**启用/关闭统计**：

```ts
await telemetry.setEnabled(true);  // 用户同意时启用
await telemetry.setEnabled(false); // 立即停止新事件采集
```

应用负责把用户选择**持久化至自身设置系统**，下次启动时 Main、Renderer 均读取同一开关。SDK 不替你实现可见的同意界面。已发送的数据无法通过开关撤回。关闭统计不会自动删除已有匿名本地 ID。

## 2. 自带的指标

| 需求 | 对应事件/方式 | 当前状态 |
| --- | --- | --- |
| PV 页面浏览量、页面路径 | `page_view` + 虚拟 HTTPS URL | 自动监听 SPA 或手动 `page()` |
| 用户去重 | Main 持久化随机 `client_id` 并传给 gtag | 已实现；GA4 原生 UV 要实测 |
| DAU/WAU/MAU | `desktop_daily_active` 每设备本地日一次；GA4 中按日期范围去重用户 | 已实现辅助事件；原生 DAU/MAU 需实测 |
| 首次用户、回访、留存 | `desktop_first_install`, `desktop_daily_active` 的 `returning_user`, `days_since_install` | 已实现辅助事件；原生留存需实测 |
| 会话 | `desktop_session_start`（启动或前台空闲 ≥30 分钟后的新会话） | 自定义桌面会话；GA4 自动 session_start 仍需实测 |
| 活跃时长 | `desktop_usage_time.foreground_seconds` 与 `active_seconds` | 只在发生真实交互后的活动阶段上报，避免空闲心跳；请勿与 GA4 原生参与时长相加 |
| 设备信息 | `desktop_device_info`（系统、系统版本、架构、应用版本、渠道、语言、时区、屏幕） | 已实现 |
| 国家、城市 | GA4 Web 默认地理推断 | 依赖 IP、政策和 GA4 原生处理，不能保证 |
| 浏览器 | GA4 自动识别 Electron Chromium UA | 实际显示为 Chromium/Electron，非 Safari/Edge 等用户外部浏览器 |
| 安装来源、UTM | `initialCampaign` / `captureAttribution()` + `desktop_attribution` | 仅有确切传入来源时有效，无法逆推出安装渠道 |
| 点击事件 | `desktop_ui_click`, 显式 `data-ga4-event` 标记 | 可选自动 |
| 滚动深度 | `desktop_scroll_depth`，25/50/75/90% | 可选自动，只监测 document |
| 功能/下载/转化 | `feature`, `download`, `conversion` | 业务代码手动上报 |
| 启动、更新 | `app_launch`, `desktop_updated` | 已实现；`startup_ms` 仅近似进程启动耗时 |
| 错误、崩溃 | `app_js_error`, `renderer_process_gone` | 已实现；主进程自身崩溃需额外系统 |
| CPU/内存 | `app_resource_sample` | 默认关闭，可选采样 |
| Web Vitals | `desktop_web_vital`（FCP、LCP、导航耗时） | 可选，针对桌面渲染器的近似指标 |
| GA4 跳出率/互动率 | GA4 自动推算 | 依赖 Cookie/session 等，无法在当前环境保证与普通网站一致 |

### DAU、WAU、MAU 如何看

在 GA4 的 Explorations / Reports 中筛选 `event_name=desktop_daily_active`，将统计周期分别设为某天、过去 7 天、过去 30 天，使用 **Total users（去重用户数）** 作为 WAU/MAU 的近似指标。不要把连续七天的日活事件数相加充当 WAU。

`desktop_daily_active` 的定义是当天有该主窗口前台活动或前台交互；不是单纯的开机，也不检查键盘输入内容。原生 GA4 Active Users 受其自身逻辑影响，应单独核验。

### 桌面会话与 GA4 原生 Session

桌面会话事件以 Electron 前台活动为依据，默认空闲 30 分钟后开始新会话。GA4 原生 `session_start` / `user_engagement` 由 `gtag.js` 管理；SDK **不会人工伪造**这些内置事件，也不每隔数秒发送无意义的心跳。桌面前台时间不代表用户实际交互时长，`active_seconds` 在 60 秒无键鼠等事件后停止累积。

## 3. 安装渠道与 UTM

```ts
// Main 在接到安装器回传 URL / Deep Link 时：
telemetryMain.captureAttribution(
  'myapp://open?utm_source=github&utm_medium=release&utm_campaign=2_0'
);

// Renderer 自己收到允许解析的渠道来源时：
telemetry.captureAttribution({
  utm_source: 'github', utm_medium: 'release', utm_campaign: '2_0',
});
```

仅保留六个 UTM 白名单字段并过滤 URL、邮箱、路径等，其他 query（如 `token=`）不传入 GA4。首次渠道、最近渠道保存在本机匿名 profile 中，**只有当前真实归因活动才设置 `gtag` 的 `campaign_*` 参数**；不会把历史安装来源强行归因到每次启动。安装来源需要安装器、官网分发链接、更新/Deep Link 真实提供，普通离线安装包无法自动知道用户从哪个网页下载。

## 4. 页面协议、GA4 设置

- **推荐**：Renderer 使用 `https://` 已托管页面，或注册 `standard` + `secure` 的 `app://` 自定义协议。不要认为设置 `virtualPageOrigin` 就能改变实际页面协议、Cookie 来源或浏览器安全上下文。
- **不推荐**：生产环境直接使用 `file://`。Cookie、存储和 Google 统计库在该场景有兼容性风险。
- Electron 自定义协议必须在 `app.whenReady()` 前调用 `protocol.registerSchemesAsPrivileged()`。自定义协议对应的 `protocol.handle()` 及路由回退由应用/构建工具负责；`examples/main.ts` 演示注册特权，`examples/app-protocol.ts` 包含可选的单页应用静态资源处理器，需由项目在 `app.whenReady()` 后使用其自身的 dist 目录注册。
- 在 GA4 Admin → Data streams → Web stream → Enhanced measurement → Page views 的设置中**关闭「Page changes based on browser history events」**。即使 `gtag('config', ..., {send_page_view:false})` 已设置，此增强型选项仍可能额外产生 PV。
- `script-src` 必须放行 `https://www.googletagmanager.com`；`connect-src`、`img-src` 还要允许 `https://*.google-analytics.com`。按照自己的 CSP 细化允许列表，勿禁用整个 CSP。
- GA4 自定义指标/维度的注册步骤见 `docs/GA4-DASHBOARD.md`。

官方文档：

- GA4 页面统计：https://developers.google.com/analytics/devguides/collection/ga4/views
- GA4 会话：https://developers.google.com/analytics/devguides/collection/ga4/sessions
- GA4 广告系列参数：https://developers.google.com/analytics/devguides/collection/ga4/reference/config
- Electron 自定义协议：https://www.electronjs.org/docs/latest/api/protocol

## 5. 本地构建与测试

```bash
pnpm install
pnpm run build
pnpm test
```

本仓库包含 CommonJS 输出和源代码。`tsconfig.offline.json` 与 `tests/shims/electron.d.ts` 仅供无 npm 网络环境下做本地类型检查，正式工程应使用 `electron` 实际提供的类型声明。

当前测试涉及：UTM 清洗、动态路由过滤、匿名事件过滤、关闭统计后不发送、首次安装、客户端 ID 重启稳定、每日活跃不重复、Renderer 崩溃事件缓存、路由 PV 去重、自动点击/滚动、转化事件及渠道参数等。**这些测试没有启动 Electron，也没有真实访问 Google Analytics。**

## 6. 隐私与限制

- 默认关闭采集。只在用户明确同意或你已有合法的分析功能启用依据时启用。
- 不会读取设备序列号/MAC、用户输入内容、文件名、下载 URL、异常堆栈、邮箱、IP 等；网络传输中 Google 仍可能依据请求 IP 推断地理位置。
- 所有自定义字符串参数必须采用业务允许的固定值。正则清洗只能降低风险，不能替你审查业务代码传入的所有敏感内容。
- `gtag.js` 的发送是 best-effort。Native Renderer 崩溃待投递事件有有限本地队列；正常 GA4 请求没有逐条确认或完整离线持久化。
- 多窗口：当前 `installMainTelemetry` 设计为**单主窗口**。多窗口应用需要将 Main IPC 注册封装成唯一单例、合并窗口活动，或只绑定主窗口。
- 地理、活跃用户、GA4 自动会话、跳出率、原生来源、留存需要按 `docs/VALIDATION.md` 实测。GA4 的 Web 属性仍然是 Web 属性，不能自动得到 Firebase 原生移动 App 的报表。
