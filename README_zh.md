# Mona Slides

简体中文 | [English](./README.md)

Mona Slides 是一个开源的浏览器演示文稿编辑器。它保留文字、图片、形状、
线条、表格、图表、媒体和公式等可编辑对象，而不是把整页幻灯片扁平化为图片。

当前仓库已经完成 PPTist 编辑器的 React 迁移。编辑器、移动端界面、放映、
演讲者工具、导入导出流程以及中英文界面都已迁移到 React，并与原实现的冻结
构建进行了双向验证。`tests/oracle/vue/` 中的 Vue 构建只用于测试，不是第二个
生产应用。

## 当前产品边界

本阶段为 Mona 后续的智能代理工作流建立可靠且等价的编辑器基础。计划中的 AI
演示文稿 SDK、云模型适配器和基于 Excalidraw 的绘图优先输入尚未在本阶段实现。
未来这些能力必须修改与人工编辑器相同的原生演示文稿模型；截图只作为检查证据，
不能取代可编辑的幻灯片数据。

## 技术栈

- React 19.2、TypeScript 7、Vite 8
- Tailwind CSS 4，以及项目自有的 shadcn/Radix 组件源码
- React Router、i18next/react-i18next、Vitest、Playwright
- 与框架无关的演示文稿、状态、富文本和交互包

经过验证的精确版本固定在 `apps/web/package.json` 和锁文件中。

## 本地运行

需要 Node.js 20.19+ 或 22.12+。

```sh
npm install
npm run dev
```

访问 <http://127.0.0.1:5173/>。根目录的 `dev`、`build` 和 `preview` 命令都指向
`apps/web` 中的 React 应用。

## 验证

```sh
npm run type-check
npm run lint
npm run test:gate2
npm run test:react
npm run e2e:react
npm run build
npm run parity:gate8
```

完整的双向一致性测试耗时较长。测试命令和最终证据记录在
[`tests/parity/PARITY_MATRIX.md`](./tests/parity/PARITY_MATRIX.md) 以及
[`doc/`](./doc/) 下的 Gate 4–8 记录中。

## 仓库结构

```text
apps/web/                    React 生产应用
packages/presentation-core/ 演示文稿模型和领域逻辑
packages/editor-state/      规范状态、事务和选择器
packages/editor-interactions/ 几何和手势逻辑
packages/rich-text/         与框架无关的富文本逻辑
packages/parity-fixtures/   共享的确定性测试数据
tests/oracle/vue/           仅用于测试的不可变编译基准
tests/gate*/                双向一致性与稳定性测试
```

界面本地化以英文为规范来源和回退语言，同时支持简体中文；法语、西班牙语、
意大利语、德语和日语已列入计划。演示文稿标题和用户编写的幻灯片内容属于文档
数据，不会被界面语言系统自动翻译。详见 [`doc/I18N.md`](./doc/I18N.md)。

## 来源与许可

Mona Slides 基于 [PPTist](https://github.com/pipipi-pikachu/PPTist) 开发，并保留
原版权与许可声明。仓库许可条款见 [`LICENSE`](./LICENSE)。
