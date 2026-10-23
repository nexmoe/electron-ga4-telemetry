# GA4 数据看板配置与指标口径

## 1. 常规 Web 指标

| 你想看什么 | GA4 使用方式 | 注意 |
| --- | --- | --- |
| 页面浏览 PV | `page_view` 的 Event count 或 Views | SDK 自动上报虚拟 `https://你的域名/desktop/...` URL；需要关闭 GA4 Enhanced measurement 的 History PV，避免重复 |
| 每日唯一设备近似 DAU | 过滤 `desktop_daily_active`，查看 Total users 或该日 Event count | Main 每个本地自然日最多发送一次；可能受丢包、重装、跨设备、时区变化影响 |
| 过去 7 天活跃设备近似 WAU | 过去 7 天，过滤 `desktop_daily_active`，Total users | 应使用去重人数，不能累加每日事件数 |
| 过去 30 天活跃设备近似 MAU | 过去 30 天，过滤 `desktop_daily_active`，Total users | 同上 |
| 新用户 | `desktop_first_install` Event count / Total users | 安装数据文件丢失或卸载清除时，会再次触发 |
| 回访用户 | `desktop_daily_active` 的 `returning_user=true` | 需创建 event-scoped 自定义维度；同一天重开不会再次产生事件 |
| 用户留存 | 按 `desktop_first_install` 首日分组，后续 `desktop_daily_active` 做 cohort | GA4 原生 Retention 依赖 `first_visit` 和 session；需实测 |
| GA4 Sessions | GA4 自动 Session 统计 | Web tag 与 Electron Cookie / URL 来源兼容性有风险 |
| 桌面自定义会话数 | `desktop_session_start` Event count | 主窗口前台活动开始新会话；30 分钟无前台活动后续聚焦再开始。与 GA4 Sessions 不保证相同 |
| 互动率/跳出率 | GA4 原生指标 | 依赖 GA4 原生 Sessions、engagement 信号，无法用 SDK 证明准确 |
| 前台时长 | `desktop_usage_time.foreground_seconds` 累计 | 窗口可见且聚焦，不代表持续操作 |
| 近似交互活跃时长 | `desktop_usage_time.active_seconds` 累计 | 60 秒无指针/键盘/滚动事件后停止累积，不能代替精确 Web engagement |
| 国家/城市 | GA4 自动推断 | 受 IP、VPN、隐私和浏览器环境影响 |
| 浏览器与操作系统 | GA4 默认维度 + `desktop_device_info` 自定义事件 | Electron WebView 通常显示 Chromium；系统/版本通过 Main 补充 |
| UTM 来源 | 自定义 `desktop_attribution`，或 GA4 session/source 相关维度 | 仅实际传入渠道时有信息；原生 Session source 需实测 |
| 点击 | `desktop_ui_click` Event count | 只在含 `data-ga4-event` 元素上统计 |
| 滚动 | `desktop_scroll_depth` | 自定义 25/50/75/90%，和 GA4 `scroll` 90% 是两套不同事件 |
| 转化 | `telemetry.conversion()` 发送的事件 | 管理员将事件标为 Key event；漏斗在 Explore 建立 |

## 2. 建议在 GA4 Admin → Data display → Custom definitions 注册

### 自定义维度：Event-scoped

| 展示名称 | Event parameter |
| --- | --- |
| 功能 | `feature_name` |
| 下载格式 | `file_format` |
| 操作名称 | `action_name` |
| 报错区域 | `error_area` |
| 错误类型 | `error_type` |
| 崩溃原因 | `reason` |
| 版本更新前版本 | `previous_version` |
| UA / 系统 | `desktop_os` |
| 应用版本 | `app_version` |
| 渠道版本 | `release_channel` |
| 会话类型 | `session_type` |
| 首次/回访标志 | `returning_user` |
| 渠道来源 | `utm_source` |
| 渠道媒介 | `utm_medium` |
| 渠道活动 | `utm_campaign` |
| 归因触发 | `touch_type` |
| Web 性能指标名称 | `metric_name` |

不要一次性将所有字段注册成高基数维度，特别是 UUID、client_id、文件名、自由输入字段。优先为业务真的用到的 5 到 10 个字段注册。GA4 标准属性对自定义定义个数有限制。

### 自定义指标：Event-scoped

| 展示名称 | Event parameter | 推荐单位 |
| --- | --- | --- |
| 前台时长 | `foreground_seconds` | Seconds |
| 交互活跃时长 | `active_seconds` | Seconds |
| 启动耗时近似值 | `startup_ms` | Milliseconds |
| 下载耗时 | `duration_ms` | Milliseconds |
| 内存占用 | `memory_mb` | Standard (数值代表 MB) |
| CPU 使用率 | `cpu_percent` | Standard (数值代表百分比) |
| 性能耗时 | `value_ms` | Milliseconds |
| 滚动阈值 | `scroll_percent` | Standard |

**注**：一个事件带的某些参数默认只会出现在事件详情 / DebugView 中，要按参数细分报告通常需要注册对应自定义维度，统计加总数值通常需要自定义指标。自定义定义注册后，报表出现数据可能有处理延迟。

## 3. 推荐的 GA4 自定义报告

1. **活跃人数报告**：以 `desktop_daily_active` 为筛选事件，折线图 X 日期、Y Total users，可切换 1/7/30 天去重口径。GA4 提供的 `Active users` 仍保留在单独图中验证，不混用。
2. **页面与功能报告**：`page_view` 按 Page path 聚合，另加 `feature_used` 按 `feature_name` 的 Event count 排名。
3. **版本质量报告**：对 `app_launch` 过滤，按 `app_version`、`desktop_os` 分组；错误另看 `app_js_error`、`renderer_process_gone`。精确崩溃率须有完整会话/设备分母。
4. **下载转化漏斗**：`download_started` → `download_completed` / `download_failed`。请在业务代码中为每个真实下载状态明确调用上报。对于中途崩溃、强制结束进程，结尾事件可能缺失。
5. **渠道**：按 `desktop_attribution` 的 `utm_source` / `utm_medium` 汇总；历史安装来源不能推断后续会话渠道，也不能把无来源安装假设成 organic。
6. **性能**：`desktop_web_vital` 按 `metric_name`，以及 `app_resource_sample` 的 `memory_mb`、`cpu_percent`。这些是抽样观测，应使用正确的统计量而非任意总和。

## 4. GA4 页面设置与来源验证

- 在 Web data stream 的 Enhanced measurement 中关闭「Page changes based on browser history events」，因为 SDK 已主动发送 SPA `page_view`。
- 如果使用 SDK 的 `desktop_scroll_depth`，可将 GA4 自动 `scroll` 作为另一个事件保留，或者关闭 GA4 自动滚动采集。
- 若同时向普通官网和 Electron 应用发送到同一 Web stream，务必用 `page_location` 虚拟域名或事件/应用版本维度区分；最好为桌面端创建**独立的 Web data stream**，以减少对官网 Web 指标的干扰。
- 如果 `gtag.js` 无法在 `app://` 下形成稳定 cookie/session，不建议让 GA4 自动 Sessions、Bounce rate 或默认 User acquisition 成为经营决策唯一依据。

官方文档：

- [GA4 session 和 engagement](https://developers.google.com/analytics/devguides/collection/ga4/sessions)
- [GA4 page views（特别注意自动 History 页面变化）](https://developers.google.com/analytics/devguides/collection/ga4/views)
- [gtag.js campaign 参数](https://developers.google.com/analytics/devguides/collection/ga4/reference/config)
- [GA4 自定义维度](https://support.google.com/analytics/answer/14239696)
- [GA4 自定义指标](https://support.google.com/analytics/answer/14239619)
