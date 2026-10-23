# GA4 Web 原生预设报表兼容指南（v0.3）

**目标**：尽量复用 GA4 官方 `gtag.js` 的事件与指标处理机制，依旧使用 **Web data stream**。SDK 只需要 `G-...` Measurement ID，无须 API Secret。无需自行重新计算 GA4 的原生活跃用户、会话、互动率、跳出率或收入指标。

**重要边界**：即使 JS 调用完全符合官方格式，GA4 原生会话/首次访问/参与时长仍依赖 `gtag.js` 在真实 Electron 页面环境中的运行情况（Cookie、页面协议、网络和 Google 的处理逻辑）。`virtualPageOrigin` 仅用于构造合规的 `page_location`；它不会把实际的 `app://` 或 `file://` 页面变成 HTTPS，也不会修复 Cookie。沙箱离线测试无法保证上述指标在打包应用中一定准确。

## HTTPS 采集桥

当前官方 tag 会中止非 HTTP/HTTPS 文档的 GA4 采集。上文的协议风险在真实 Electron 中已确认，`standard + secure` 或虚拟 `page_location` 都不能改变这个检查。自定义协议应用应使用根 README 中的 `/transport` 与 `/transport-preload`，让官方 tag 在独立 HTTPS 页面中处理原生会话与 cookie。

采集页不包含应用 DOM。桥接模式通过应用侧适配器处理路由、内部容器滚动、链接、表单、HTML5 视频和 URL 搜索；脱敏策略仍要求表单/视频显式标记。可选 `youtubeVideo` 使用官方 iframe API，`nativeDownloads` 接收真实 DownloadItem，原生外链通过 `recordExternalOpen` 接入。宿主须显式启用对应选项，YouTube 还受 CSP、Referer 和第三方播放策略约束。无需把采集页的空白文档当作应用页面。完整原生命令通过 `gtag(...args)` 转发；过滤后的 `track()` 是另一个可选策略接口。

## 1. 预设指标对应关系

| GA4 Web 预设指标/报告 | 数据基础 | SDK 负责什么 | 实际验证 |
|---|---|---|---|
| Total users、Active users、DAU、WAU、MAU | GA4 用户身份、活动和事件 | 持久化匿名 `client_id`，交给官方 gtag，记录辅助 `desktop_daily_active` | 核对 GA4 与测试设备的去重 |
| New users、Returning users、Retention | `first_visit` 和 Google 的用户身份计算 | Google gtag 自动事件；辅助 `desktop_first_install` | 重启不应反复出现“首次访问”；Cookie 异常可能影响 |
| Sessions、Engaged sessions、Bounce rate、Engagement rate | `session_start`、`user_engagement` 和 Google 会话模型 | 保留 gtag 自己的自动事件；提供独立的 `desktop_session_start` 用于核验 | 观察真实会话/参与事件；禁止人为 heartbeat |
| Views、Pages and screens | `page_view`, `page_title`, `page_location`, `page_referrer` | 路由级自动/手动 PV，固定虚拟 HTTPS URL，避免敏感路径和重复事件 | 实时及页面路径报表核对 |
| Events | `gtag('event', ...)` | 原生命名、标准参数，合规过滤，可转发 `items[]` | 在 Realtime 和 DebugView 中核对 |
| Scroll、outbound click、file download、form/video | GA4 Enhanced Measurement | 默认由 Web tag 处理；如果 Electron 环境无法自动捕获，可**显式开启兼容采集** | 对应 GA4 增强衡量必须关闭同类型自动采集以免重复 |
| Login、Sign up、Search、Share | 官方推荐事件 | `login`, `signUp`, `search`, `share` | 在 GA4 Events / Explore 查看。Search 需显式同意采集搜索词 |
| Revenue、Purchases、Ecommerce | `purchase`, `refund`, `add_to_cart` 及必填交易字段 | 保留标准 `currency`, `value`, `transaction_id`, `items[]` | Monetization 报告约 24–48 小时后核对 |
| User acquisition、Traffic acquisition | Google Session source / first user source | 仅在确有安装器、Deep Link UTM 时透传 campaign 信息 | 离线安装来源无法通过 SDK 推断；常出现 `(direct) / (none)` |
| Country、City、Browser、OS、Device category | GA4 自动采集和 Google 推断 | Web gtag 自动采集，附带 Electron `desktop_device_info` | 浏览器会识别 Electron 的 Chromium；地理信息会受到网络和策略影响 |

GA4 自动事件与推荐事件官方说明：
- https://developers.google.com/analytics/devguides/collection/ga4/events
- https://developers.google.com/analytics/devguides/collection/ga4/reference/recommended-events
- https://developers.google.com/analytics/devguides/collection/ga4/sessions

## 2. 最小接入：让 gtag 计算自己的指标

```ts
const ga4 = new ElectronGA4Telemetry({
  measurementId: 'G-XXXXXXXXXX',
  virtualPageOrigin: 'https://desktop.yourdomain.com',
  enabled: analyticsConsent,   // 读取持久化授权，与 Electron Main 一致
  autoPageViews: true,
  routeMode: 'history',
  mapRoute: path => {
    if (path === '/') return 'home';
    if (path === '/settings') return 'settings';
    if (path.startsWith('/downloads')) return 'downloads';
    return 'other';
  },
});
await ga4.init();
```

从 Main 调用 `installMainTelemetry` 并在 preload 调用 `installTelemetryPreload`，详见根目录 README。`page_view` 由页面监听逻辑发出一次，`first_visit` / `session_start` / `user_engagement` 保持 Google 自动采集；SDK 明确阻止业务代码手动伪造这些事件。

必须在 GA4 Admin → Data streams → Web → Enhanced measurement → Page views **关闭基于 Browser history changes 的 PV 自动上报**。因为 `send_page_view: false` 只关闭 tag 配置触发的 PV，无法单独关闭增强衡量的 History PV。

## 3. 官方推荐事件直接进入预设分析

```ts
// 确实成功登录/注册后触发
telemetry.login('google');
telemetry.signUp('email');
telemetry.share('X', 'video', 'demo_video');

// 原生 GA4 收入报表需要正确交易金额、币种和商品明细
afterPaymentSuccess(() => telemetry.purchase({
  transaction_id: 'order_123',
  currency: 'USD',
  value: 19.99,
  items: [
    { item_id: 'pro_monthly', item_name: 'Pro Plan', price: 19.99, quantity: 1 }
  ],
}));

// 只有退款真正成功后才发送
telemetry.refund({ transaction_id: 'order_123', currency: 'USD', value: 19.99 });

// 可以继续使用标准 gtag 事件名与参数（不允许敏感或任意嵌套对象）
telemetry.track('tutorial_complete');
telemetry.track('select_content', { content_type: 'tab', content_id: 'downloads' });
```

> `afterPaymentSuccess` 为业务伪代码，不属于 SDK API。`transaction_id` 请使用无个人信息的交易 ID。测试交易建议使用单独 GA4 测试流，以免污染真实收入报表。

`search_term` 可以包含敏感信息，所以默认禁用。经隐私评估、允许采集后打开 `allowSearchTerms: true` 并主动调用 `telemetry.search('approved search query')`。URL、电子邮箱、文件路径和包含密钥的文本会被过滤。

GA4 将关键事件标记（Key events）和 Funnel exploration 视为 GA4 后台配置，SDK 无法替应用自动创建。标准报表对参数的要求详见官方推荐事件文档。

## 4. Electron 增强型衡量兼容模式（可选）

如果 Web tag 在 Electron 页面中没有正常捕获 DOM 交互，可以开启对应的手动兼容事件：

```ts
const telemetry = new ElectronGA4Telemetry({
  measurementId: 'G-XXXXXXXXXX',
  virtualPageOrigin: 'https://desktop.yourdomain.com',
  enabled: analyticsConsent,
  enhancedFallback: {
    confirmedNativeEnhancedMeasurementDisabled: true,
    scroll: true,
    outboundClicks: true,
    fileDownloads: true,
    forms: true,
    html5Video: true,
  },
});
```

配置前，须在 GA4 对应 **Web data stream** 中关闭同类型的增强型衡量自动采集，尤其是 Scrolls、Outbound clicks、File downloads、Form interactions、Video engagement。**不要同时开启 Google 自动采集和 SDK 同类 fallback**，否则重复计数。

- `scroll`：根 document 首次滚动达到 90% 时发送。带 `percent_scrolled=90`。
- `click`：站外 HTTPS 链接点击。只传公开的域名与去掉路径/参数的 URL origin。
- `file_download`：点击常见文件扩展名的 HTML 链接。如果下载由 Electron 下载管理器触发，需业务代码显式调用 `telemetry.fileDownload('mp4')`。表示下载操作，不代表下载成功；下载成功请继续使用 `telemetry.download('completed', ...)`。
- `form_start` / `form_submit`：仅追踪带 `data-ga4-form="signup"` 的 `<form>`，从不读取表单内容。
- `video_start` / `video_progress` / `video_complete`：仅追踪带 `data-ga4-video="demo_video"` 的原生 `<video>`；不会从文件路径或视频标题自动读取个人内容。普通 HTTP/HTTPS 页面上的 YouTube iframe 可由官方增强衡量处理；自定义协议桥接使用独立 `youtubeVideo` 适配器，不会从隐藏 collector 自动观察到 iframe。
- 网站搜索 `view_search_results` / `search` 不会抓取任意 URL 查询词。请主动上报经过批准的非敏感查询。

```html
<form data-ga4-form="signup">...</form>
<video data-ga4-video="demo_video" controls>...</video>
```

## 5. 打包环境的会话自检

调试时启用 `debug: true`，然后在渲染进程里查看：

```ts
console.table(await telemetry.diagnostics());
```

预期包含：

```json
{
  "enabled": true,
  "protocol": "app:",
  "scriptLoaded": true,
  "clientIdMatchesProfile": true,
  "sessionIdPresent": true,
  "sessionNumberPresent": true
}
```

这些是本地 `gtag('get', ..., 'client_id' | 'session_id' | 'session_number')` 诊断值，不包含用户实际 ID；它们表明 tag 的内部状态，**无法单独证明 GA4 报表已经入库或参与度计算完全正确**。

还要打开 Electron DevTools Network，检查 `gtag/js` 与 `g/collect` 网络请求；在 GA4 DebugView / Realtime 核对 `page_view`、`session_start`、`first_visit`、`user_engagement`、`purchase`。真实 Session 应在明确的活动期间出现合理事件。GA4 通常需要 24 至 48 小时处理标准报表数据。

官方 API：https://developers.google.com/tag-platform/gtagjs/reference
验证文档：https://developers.google.com/analytics/devguides/collection/ga4/troubleshoot

## 6. 未解决限制

1. `app://` 的 `standard + secure` 设置有助于 Web Storage/Cookie，但不保证 Google Tag 能像 HTTPS 网页一样识别所有 Session；`file://` 风险更高。
2. 即使 `client_id` 持久化，GA4 的首次访问、用户身份、会话和留存仍可能受 Cookie/Consent/Google 处理规则影响。
3. 桌面应用缺乏浏览器导航的 Referrer；官网、下载渠道必须显式透传 UTM，离线安装归因无法推断。
4. 弹窗、多窗口、跨设备的用户去重需要明确身份模型；本项目依旧只绑定一个主窗口。
5. 已通过 TypeScript 和本地 Node 模拟测试；仍须在实际发行包内验证 GA4 后台结果。

**异常指标**：SDK 自动使用 GA4 的标准 `exception` 事件记录经过脱敏的 Renderer 错误和崩溃类型，同时保留 Electron 自定义错误事件。不传输堆栈、文件名、异常 message 或原始错误文本。
