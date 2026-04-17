# miniprogram-design-qa

面向 **微信小程序** 的原生优先视觉与交互验收工具。

语言版本：

- English: [README.md](./README.md)
- 简体中文: [README.zh-CN.md](./README.zh-CN.md)

版本说明：

- English: [RELEASE_NOTES.md](./RELEASE_NOTES.md)
- 简体中文: [RELEASE_NOTES.zh-CN.md](./RELEASE_NOTES.zh-CN.md)

这个仓库以 GitHub 源码仓库的方式共享，当前**不**定位为 npm 包。

这个仓库可以以两种方式使用：

1. 作为 Codex skill
2. 作为面向任意代码 agent 或工程师的自动化 / 工具仓库

核心目标很简单：

- 收集 **原生运行时证据**
- 与可选的设计基线做比对
- 产出结构化 findings
- 支持高置信前端问题的 repair-loop workflow
- 生成中文初验 / 复验报告

## 哪些部分是通用的

这些部分是 agent-neutral 的：

- [`scripts/`](./scripts)
- [`templates/qa-scenario.example.json`](./templates/qa-scenario.example.json)
- [`templates/qa-scenario.schema.json`](./templates/qa-scenario.schema.json)
- [`references/`](./references)

这些部分更偏 Codex 元数据：

- [`SKILL.md`](./SKILL.md)
- [`agents/openai.yaml`](./agents/openai.yaml)

如果别的 agent 能读文件、跑命令、改代码，它同样可以直接使用通用层。

## 快速开始

1. 安装依赖：

```bash
npm install
```

2. 复制一个 scenario 模板到你的消费项目里：

```bash
cp templates/qa-scenario.example.json /path/to/consumer-project/qa/example.json
```

3. 检测项目：

```bash
npm run qa:detect -- --project-root /path/to/consumer-project
```

4. 执行原生截图：

```bash
npm run qa:capture -- --project-root /path/to/consumer-project --scenario /path/to/consumer-project/qa/example.json
```

或者直接调用 DevTools 执行器：

```bash
npm run qa:capture:devtools -- --project-root /path/to/consumer-project --scenario /path/to/consumer-project/qa/example.json
```

5. 如果有本地设计基线，再执行 compare：

```bash
npm run qa:normalize -- --actual actual.png --design design.png --output-dir .qa-output/normalized
npm run qa:compare -- --actual .qa-output/normalized/actual.normalized.png --design .qa-output/normalized/design.normalized.png --output .qa-output/diff.png
```

6. 或直接跑完整 pipeline：

```bash
npm run qa:pipeline -- --mode initial --project-root /path/to/consumer-project --scenario /path/to/consumer-project/qa/example.json
```

修复完成后再跑复验：

```bash
npm run qa:pipeline -- --mode final --project-root /path/to/consumer-project --scenario /path/to/consumer-project/qa/example.json --repaired-issues repaired-issues.json
```

## 消费项目契约

消费项目应提供：

- 一个或多个 scenario JSON
- 稳定的 route 和 fixture / state setup
- 明确的 ready markers
- 可选的动态区域 masking selector
- 可选的项目侧 prepare / capture hook

对于带 tab 的页面，默认应优先通过 route / query 进入目标 tab，而不是依赖 capture 时点击。

默认 capture 路径是：

1. 内建 DevTools 原生 capture
2. 可选项目适配器 / hook
3. 手工运行时截图 fallback

相关契约文档：

- [references/scenario-schema.md](./references/scenario-schema.md)
- [templates/qa-scenario.schema.json](./templates/qa-scenario.schema.json)
- [references/output-artifacts.md](./references/output-artifacts.md)

## 当前能力范围

当前一等支持：

- 微信小程序
- Taro `weapp`
- 基于本地设计图或本地 baseline 图的原生截图比对
- scenario 中携带 Figma metadata 供外部流程使用

已知限制：

- WeChat mini-program 是当前的一等运行时目标
- DevTools 自动化稳定性仍然依赖本机环境
- `capture-devtools` 已可用并能输出结构化 phase 错误，但仍受 DevTools 会话状态影响
- `run-qa-pipeline` 已支持 `capture -> compare -> classify -> report`，但源码修复仍由外部 agent / 工程师执行
- `figmaFileKey` / `figmaNodeId` 只是 metadata，内建 pipeline 不会直接从 Figma 导图
- `ignoreRegions` 在能解析 selector 几何时可用于 built-in compare；fallback/manual 路径下可能只给 warning

## 命令列表

- `npm run qa:detect -- --project-root <path>`
- `npm run qa:launch -- --project-root <path>`
- `npm run qa:capture:devtools -- --project-root <path> --scenario <file>`
- `npm run qa:capture -- --project-root <path> --scenario <file>`
- `npm run qa:normalize -- --actual <file> --design <file> --output-dir <dir>`
- `npm run qa:compare -- --actual <file> --design <file> --output <file>`
- `npm run qa:classify -- --findings <file>`
- `npm run qa:report:initial -- --input <file>`
- `npm run qa:report:final -- --input <file>`
- `npm run qa:pipeline -- --mode initial|final --project-root <path> --scenario <file>`
- `npm run smoke`
