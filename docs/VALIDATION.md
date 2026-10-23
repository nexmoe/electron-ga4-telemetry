# Electron + gtag.js 生产验证清单

## 当前运行边界

当前官方 gtag 会中止非 HTTP/HTTPS 文档的 GA4 采集；自定义协议应用应使用 `/transport` 和 `/transport-preload`。`standard + secure` 与虚拟 `page_location` 不能代替 HTTPS 采集页。下面保留 v0.3 的原始验收项，须结合根 README 的桥接方式使用。

桥接验收须检查：官方请求中的会话与首次访问标记、原生 engagement_time_msec、应用前后台状态、匿名 ID 与会话跨重载持久性、事件回调、原始电商参数、禁用采集和未授权 renderer 拒绝。`user_engagement` 只汇总尚未附在其他事件中的参与时长，不能仅以该独立事件是否出现判断全部参与度。

## 生产身份与恢复加固（2026-10-23）

自动入口的 Main 身份文件现为持久化来源；首次迁移既有 Renderer ID，后续重启及辅助窗口使用相同 ID。
回归覆盖：存储缺失/拒绝/残留旧值、并发窗口、身份更新同步、原子替换中断保留旧文件、
禁用时不创建身份、重新启用保持身份、Google 原生身份 opt-out、命令先后顺序和慢回调不阻塞业务事件。
采集窗口崩溃后恢复 consent/config/set，关闭额外 PV，不重放事件；覆盖重试上限和退出取消重试。

`node tests/electron-production.cjs` 在独立临时 userData 中运行两次完整 Electron 进程，
验证旧 ID 迁移、多窗口同步、实际 `forcefullyCrashRenderer()` 后命令队列恢复，以及改变首次窗口、
Renderer 残留旧 ID 后的跨进程重启保持身份。所有 Google 脚本和采集请求在创建 collector 前被阻断；
本机 Electron 39.8.9 / macOS 已通过。这证明 Electron 生命周期、IPC、配置恢复和磁盘持久化，
不证明 Google 入库、原生参与度或标准报表准确，也不代替签名安装包覆盖升级及 Windows/Linux 验收。

Main 的 `onError` 和 `diagnostics()` 用于检测身份降级到内存、collector 故障与重试耗尽；
身份文件所在 userData、collector partition 和身份键需要跨发布保持稳定。应用应由单个 Main 拥有
该 transport。用户清空应用数据会重置安装身份；磁盘不可写时不保证下次启动保持身份。

## 2026-10-23 真实接入与后台结果

联调直接链接本地 `electron-ga4-telemetry`，在 Viora 的生产 profile 完整构建、真实 Electron、
`viora://` renderer 中运行，使用独立 userData；没有使用 E2E 的认证或后端替身。
Measurement ID 为 `G-P3EMH45Z9G`，属性为
[Viora Desktop](https://analytics.google.com/analytics/web/#/a391568952p560476207/realtime/overview)。

已确认：

- 主进程实际打开系统浏览器后，上报 `click`；实际 HTTP 下载返回附件文件名，Electron
  DownloadItem 完成保存，上报 `file_download`，脱敏请求不含原始文件名和本地路径。
- 应用 DOM 中的标记表单、真实内部滚动容器和实际播放的 HTML5 视频分别产生
  `form_start`、`form_submit`、90% `scroll`、`video_start`、10/25/50/75% `video_progress`、
  `video_complete`。DOM/媒体为验收 fixture，不能据此宣称每个宿主业务面板均已验收。
- 上述事件实际 Google 请求均返回 204，参数中没有表单输入值或外链私有 query。
- Realtime 确实出现 `first_visit`、`session_start`、`user_engagement`、页面浏览以及上述增强事件，
  因此已证明实时入库，不再只依赖 collection endpoint 的 HTTP 状态。
- SDK 暂停时请求被阻止，恢复后原生 ID/会话及回调正常，重建 renderer、重启应用后身份保持。
- 原生 consent 拒绝再授权后，后续实际事件可恢复身份回调；单独 `get(client_id)` 曾超时。
  对完全绕过客户端/preload 的官方 tag 做相同对照，也复现先超时、后续事件后恢复；
  这是实测原生行为，不是桥接额外丢失。`tests/electron-consent.cjs` 保留独立对照命令。
  不注入伪造页面/业务事件来掩盖此边界，也不将 SDK 暂停等同于撤回 consent。
- 用户授权的真实生产认证完成后，Desktop 发出 `desktop_activation_completed`，
  `client_id_linked=true`；Realtime 也出现该激活事件。引导按用户要求走跳过分支，未提交业务问题。

YouTube 的官方 API 与真实 embed 能加载，已按官方契约安装监听器；播放被 YouTube 的
“Sign in to confirm you’re not a bot” 阻断，**开始/进度/结束未完成真实验收**。
独立命令 `GA4_MEASUREMENT_ID=G-... pnpm exec electron tests/electron-youtube.cjs`
允许设置 `YOUTUBE_VIDEO_ID`，需要可正常播放的网络环境；阻断退出码为 2，不能当作通过。

系统 suspend/resume、lock/unlock 已接线，但未主动休眠或锁住用户电脑；精确参与时长、
签名安装包、Windows/Linux 真机、标准报表、留存和来源归因未验收。GA4 Web stream 及原生
命令兼容不等于 Google Ads/Floodlight、多 property 漏斗或全部 gtag 场景已经验证。
15 个相关库契约测试及真实 Electron transport smoke 通过；未运行整个宿主仓库门禁。

## 自动初始化验收（2026-10-23）

`tests/electron-automatic.cjs` 只配置 Main 和已有 Preload，没有 Renderer 初始化、业务入口或
额外加载器。真实沙箱 Electron、自定义协议、`script-src 'none'` 下已确认自动初始化、原生
Google client/session 回调、默认内部滚动、固定路由映射、不可信窗口拒绝及重载身份保持。
真实 Viora 发现首次双窗口生成不同匿名 ID 的竞态；Main 已按身份存储键串行协调并复用 ID，
同时跟随可信 renderer 的身份更新。新增并发双窗口的公开 config、存储与原生 Google ID 一致性验收。
验收只读取可序列化的事件，避免把原生回调函数跨进程返回误报为产品故障。

33 项库内快速契约测试通过。`dist/desktop.js` / `dist/gtag.js` 分支覆盖率合计 73.33%，
自动握手与 preload 的真实 Electron 覆盖未合并进该数值，不代表整个库的覆盖率。
自动初始化入口默认启用，consent/广告策略仍由宿主选择；初始配置通过可信 Main 注入，
没有关闭 contextIsolation/sandbox 或添加 unsafe-eval。原有手动 API 保留。

## 桌面快捷入口验收（2026-10-23）

新增 `/desktop` 统一单例、匿名 ID 持久化和增强采集默认值；旧存储键迁移、无权限存储降级、
禁用时不创建 ID 均有 DOM/存储契约覆盖。真实 Electron `tests/electron-transport.cjs` 已验证
默认内部滚动、真实 DownloadItem 下载与原生外链脱敏、Google client/session 回调、暂停/恢复及销毁重建后的身份保持。
脚本先等待 collector 加载就绪，再开始 Google 回调截止计时，避免把首次脚本加载延迟算作回调失败。

30 项库内契约测试通过；本次涉及的 `dist/desktop.js` / `dist/gtag.js` 分支覆盖率合计 76%，
其中快捷入口为 92.86%。剩余主要为真实 preload 桥接回调与路由分支，另有真实 Electron smoke，
但未将 Electron 覆盖数据合并进该数字；不代表整个库均达到此覆盖率。

## v0.3 原始验收清单

以下清单主要针对旧 `/main`、`/renderer` 可选桌面指标；其自定义日活/会话/滚动不能代替
官方 GA4 指标。当前 `/gtag` 桥接增强层是单次 90% 滚动并可观察内部容器；宿主不需要
在自己的自定义协议页面额外加载第二份 gtag.js。

## 0. 环境要求

- [ ] GA4 Web data stream Measurement ID 正确，最好使用独立桌面 Web stream。
- [ ] Renderer 使用正常 HTTPS 来源，或 Electron 注册 `standard + secure` 的 `app://`；`file://` 只能作为兼容性测试目标。
- [ ] `app://` 有实际的 `protocol.handle` / 项目构建工具协议处理器，且 `BrowserWindow` 的 `session/partition` 与 handler 所属 session 一致。
- [ ] `script-src` 允许 `https://www.googletagmanager.com`，`connect-src` 和 `img-src` 允许 GA4 请求域名；CSP 其余部分仍保持安全。
- [ ] 不把任何 API Secret、Service Account Credentials、Google 登录令牌打进 Electron 客户端。这里只使用 `G-...`。
- [ ] Main 和 Renderer 的 `enabled` 取自一致的持久化用户统计偏好，关闭时不会加载 Google tag。

## 1. 网络验证

1. 开启统计，然后看 DevTools Network。应出现 `https://www.googletagmanager.com/gtag/js?id=G-...`。
2. 根据网络/浏览器版本，GA4 事件请求可能落到 `https://www.google-analytics.com/g/collect` 或地区域名、不同传输形式。关注实际请求状态及 GA4 DebugView，不要只依赖固定 URL 字符串。
3. `gtag('config')` 设置 `send_page_view:false`，插件或其他页面不得再自行发送重复 PV。
4. 关闭统计后不再发出新的 GA4 事件；已进入浏览器网络队列的请求可能无法即时撤销。
5. 没网 / Google Tag 被阻止时应用仍能正常工作（只有遥测丢失，绝不能阻止核心业务）。

## 2. 用户 ID / 活跃数 / Sessions

- [ ] 第一次同意后创建 `userData/ga4-telemetry-profile.json`，重启前后 Client ID 完全相同。
- [ ] 关闭统计后，不产生新的业务事件，也不泄露用户输入。
- [ ] 清除应用用户数据 / 重装且清理用户目录，会产生新 Client ID，属于新的安装身份。
- [ ] 同一设备同一自然日多次启动，`desktop_daily_active` 在本机只产生一次。
- [ ] 跨自然日再次前台活跃时，新增一次 `desktop_daily_active`。
- [ ] 30 分钟空闲后再次使用，出现新的自定义 `desktop_session_start`；与 GA4 原生 `session_start` 单独比较。
- [ ] GA4 Realtime → Users 能看到客户端；GA4 DebugView 事件完整。检查 `session_start`、`user_engagement` 是否由官方 gtag 自动触发，而不是仅看到自定义 desktop 事件。
- [ ] 判断 GA4 `Total users` / `Active users` 与实际测试设备数是否接近（避免从纯 SDK 模拟测试直接断言）。
- [ ] 跳出率、互动率、GA4 Retention 的实验结果与真实桌面行为是否一致。若偏差明显，采用自定义桌面事件 cohort 与 Session 分析作为主要依据。

## 3. 页面、来源、设备

- [ ] 首页打开产生一次 `page_view`。
- [ ] React Router / Next Router 导航每次仅产生一个虚拟 `page_view`；在 GA4 Enhanced measurement 中关闭基于 History 变化的 PV。
- [ ] 页面路径不含 `file://`、真实文档路径、下载地址、用户 ID 或查询参数。
- [ ] `data-ga4-event` 点击会上报，任意未标记按钮和表单字段不会被自动收集。
- [ ] 根 document 的 25/50/75/90% 滚动阈值按页面报；复杂内部滚动容器需要显式埋点。
- [ ] 系统、架构、应用版本、语言、分辨率与真机相符。macOS OS 版本优先由 Electron `process.getSystemVersion()` 取得。
- [ ] 地理（Country、City）是否按 IP 推断；它可能为空或与真实地理位置不同。
- [ ] 只有确实收到 `utm_source` 等参数的安装/Deep Link 才出现来源事件。普通离线安装没有自动来源值。
- [ ] 如果 GA4 Session source 与 `desktop_attribution` 不一致，改看自定义来源报表，勿假定来源自动准确。

## 4. 使用时长、错误、性能

- [ ] 窗口聚焦 → 失焦：`desktop_usage_time.foreground_seconds` 只反映有实际交互的前台时间段；长时间无操作不会持续上报空闲心跳。
- [ ] 60 秒完全没有输入，`active_seconds` 不继续累计；休眠/调试暂停期间不会累计整个休眠时间。
- [ ] 人为抛出异常后，只出现异常类型和受控区域，不出现 Error.message / stack / 文件路径。
- [ ] Renderer 崩溃产生 `renderer_process_gone`，可在重新创建/恢复 Renderer 后上报。
- [ ] `app_resource_sample` 仅用户授权且选项开启、窗口处于前台时按间隔采样；CPU/内存跨平台差异须检查。
- [ ] 可选 FCP/LCP/Navigation 指标在目标 Electron 版本下有意义；不要直接与普通公网网页 Web Vitals 混在同一评测里。

## 5. 仍未验证或无法从客户端独立保证的部分

- 真实 GA4 上报入库、网络阻断、Cookie 策略、所有地域的 Web Tag 行为。
- GA4 自动的 `first_visit`、`session_start`、`user_engagement`、`bounce_rate`、原生用户留存。
- GA4 默认归因能否正确采纳自定义 `campaign_*` 并映射 Session source。
- 所有升级、卸载、Profile 重置、跨进程窗口同步情况下的去重。
- 离线事件的完整持久化和可靠送达。当前实现是 best-effort，只有部分 native 崩溃缓冲队列。
- 多窗口同时安装 Main telemetry。当前只允许一个主窗口注册 IPC handlers。

## 6. GA4 Web 官方预设指标专项检查

请阅读 [GA4 Web 预设指标兼容指南](./GA4-WEB-PRESETS.md)，验证 `telemetry.diagnostics()` 显示真实的 `client_id`、`session_id`、`session_number` 状态。

- [ ] 首次授权后，`page_view`、`session_start` 和 `user_engagement` 在 GA4 DebugView 可见；同一安装重启后 `first_visit` 不异常增长。
- [ ] 真实一次登录成功产生一条 `login`，注册成功一条 `sign_up`，并在 GA4 预设 Events 中显示。
- [ ] 真实/测试交易用完整 `purchase` 参数（`transaction_id`, `value`, `currency`, `items[]`）核对 Revenue。
- [ ] 若使用 `enhancedFallback`，在 GA4 Web data stream 关闭对应自动增强型衡量后再启用；检查 Scroll、Click、Download、Form、Video 不重复。
- [ ] Standard reports 在 24–48 小时后核对，与 Realtime/DebugView 对比，注意网络、时区、用户身份差异。
