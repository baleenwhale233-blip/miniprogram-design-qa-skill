# 版本说明

## 首个公开版本

这个版本把 `miniprogram-design-qa` 建立为一个面向微信小程序的原生优先 QA 工具仓库。

### 关键能力

- 新增内建的 DevTools 原生截图路径
- 新增 fallback-aware 的 capture wrapper，覆盖：
  - 内建 DevTools capture
  - 项目侧 capture adapter / hook
  - 手工运行时截图
- 新增初验 / 复验两阶段 pipeline，串联：
  - capture
  - compare
  - classify
  - report
- 新增 machine-readable 输出工件说明
- 收紧公共契约，让文档、schema 和代码更一致
- 把 route/query-driven tab 进入方式明确为 state-oriented tab QA 的默认策略
- 在能解析 selector 几何时，内建 compare 已支持 `ignoreRegions` mask

### 当前可用能力

- 微信小程序页面的原生运行时截图
- 基于 scenario 的 QA：
  - route
  - query
  - viewport
  - readySignal
  - segmentSelectors
- 基于本地图片的 built-in compare：
  - design screenshot
  - baseline screenshot
- repair-loop workflow：
  - findings 分类
  - 外部修复步骤
  - 复验报告
- `ignoreRegions` mask（在 capture 能解析 selector 几何时）
- 机器可读输出：
  - capture metadata
  - findings
  - classification
  - reports
  - pipeline summary

### 重要契约说明

- 仓库当前**不会**自己改业务源码
- Figma 目前是 **metadata-oriented**：
  - scenario 可以带 `figmaFileKey` / `figmaNodeId`
  - 但 built-in compare **不会**直接从 Figma 导出截图
- 内建视觉比对只消费本地图片：
  - `designImagePath`
  - `baselineImagePath`
- `network-idle` 在当前实现里只是 page-data stability polling 的兼容别名，不是浏览器级 network idle
- 对于带 tab 的页面：
  - 验视觉/状态时，默认优先 route/query 进入目标 tab
  - 只有显式要验切换交互时，才使用 capture-time tap

### 已知限制

- 当前一等支持的运行时仍然是微信小程序
- DevTools 自动化仍然会受本机环境和会话状态影响
- fallback/manual capture 路径下，`ignoreRegions` 可能只有较弱行为或 warning
- in-repo 源码修复仍然不在范围内，修复继续由外部 agent / 工程师完成

### 主要命令

- `npm run qa:detect`
- `npm run qa:launch`
- `npm run qa:capture:devtools`
- `npm run qa:capture`
- `npm run qa:pipeline`
- `npm run qa:compare`
- `npm run qa:classify`
- `npm run smoke`
