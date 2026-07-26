# Mona

简体中文 | [English](./README.md)

Mona 是一个开源的桌面演示文稿编辑器。它保留文字、图片、形状、
线条、表格、图表、媒体和公式等可编辑对象，而不是把整页幻灯片扁平化为图片。

它以 Electron 应用的形式运行：React 渲染进程运行在负责托管代理的外壳进程之内。
不监听任何端口，也不会把内容发送到任何地方。演示文稿以文件形式保存在应用管理的
文件夹中，代理则使用本机已有的 Claude 登录在本机运行。

编辑器、移动端界面、放映、演讲者工具、导入导出流程以及中英文界面均使用
React 实现。仓库现在使用 Mona 自有的产品测试和确定性测试数据，不再保留第二套
前端框架作为参考运行时。

## 智能代理编辑

Mona 已支持绘图优先和文本优先的演示文稿代理流程。Excalidraw 草图按幻灯片保存，
并可作为视觉意图交给 Mona。代理同时读取原生演示文稿结构和渲染后的幻灯片图像，
代理会拿到以文件形式提供的演示文稿工作区，并使用普通工具直接编辑这些文件；
返回的结果只在入口处校验一次，无论经过多少轮，都作为一次可撤销事务应用。
最终生成的仍是普通、可编辑的演示文稿元素；截图仅用于检查，不会成为幻灯片数据。

代理通过 Claude Agent SDK 运行在桌面外壳自己的进程中，使用本机已有的 `claude`
登录。Mona 无需保存任何凭据，演示文稿也没有可被发送的去处。

## 技术栈

- Electron 43，渲染进程通过自定义 `mona://` 协议提供
- React 19.2、TypeScript 7、Vite 8
- Tailwind CSS 4，以及项目自有的 shadcn/Radix 组件源码
- React Router、i18next/react-i18next、Vitest、Playwright
- 与框架无关的演示文稿、状态、富文本和交互包

经过验证的精确版本固定在 `apps/web/package.json` 和锁文件中。

## 本地运行

需要 Node.js 24.13.1+ 和 npm 11+，具体版本见 `engines` 字段。

```sh
npm install
npm run dev
```

应用窗口会自行打开。`dev` 会启动 Vite（渲染进程）和 Electron（外壳进程），
窗口加载 Vite 的地址以支持热更新；打包后的版本则通过 `mona://app` 提供同一份
渲染进程代码。没有可以在浏览器中打开的页面——编辑器依赖外壳提供的桥接接口，
而普通浏览器标签页没有这个接口。

## 验证

```sh
npm run type-check
npm run check:architecture
npm run lint
npm run test:core
npm run test:react
npm run e2e:react
npm run build
```

## 仓库结构

```text
apps/web/                    React 生产应用
apps/desktop/                Electron 外壳：窗口、菜单、文件、协议
apps/agent-server/           代理运行时：会话、工作区、工具与流式输出
packages/agent-protocol/     共享的代理程序与检查协议
packages/presentation-core/ 演示文稿模型和领域逻辑
packages/editor-state/      规范状态、事务和选择器
packages/editor-interactions/ 几何和手势逻辑
packages/rich-text/         与框架无关的富文本逻辑
packages/test-fixtures/     共享的确定性测试数据
tests/core/                 与框架无关的集成测试
tests/performance/          状态与交互性能预算
tests/stability/            生产环境稳定性测试
tests/corpus/               真实 PowerPoint 测试数据元信息
```

界面本地化以英文为规范来源和回退语言，同时支持简体中文；法语、西班牙语、
意大利语、德语和日语已列入计划。演示文稿标题和用户编写的幻灯片内容属于文档
数据，不会被界面语言系统自动翻译。详见 [`doc/I18N.md`](./doc/I18N.md)。

## 来源与许可

Mona 保留所采用开源软件的版权与许可声明。来源信息见 [`NOTICE.md`](./NOTICE.md)，
仓库许可条款见 [`LICENSE`](./LICENSE)。
