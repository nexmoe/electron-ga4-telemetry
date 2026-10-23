# Electron + gtag.js 生产验证清单

## 当前运行边界

当前官方 gtag 会中止非 HTTP/HTTPS 文档的 GA4 采集；自定义协议应用应使用 `/transport` 和 `/transport-preload`。`standard + secure` 与虚拟 `page_location` 不能代替 HTTPS 采集页。下面保留 v0.3 的原始验收项，须结合根 README 的桥接方式使用。

桥接验收须检查：官方请求中的会话与首次访问标记、原生 engagement_time_msec、应用前后台状态、匿名 ID 与会话跨重载持久性、事件回调、原始电商参数、禁用采集和未授权 renderer 拒绝。`user_engagement` 只汇总尚未附在其他事件中的参与时长，不能仅以该独立事件是否出现判断全部参与度。

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
