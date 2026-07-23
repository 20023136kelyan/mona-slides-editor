# Mona

简体中文 | [English](./README.md)

Mona 是一个开源的浏览器演示文稿编辑器。它保留文字、图片、形状、
线条、表格、图表、媒体和公式等可编辑对象，而不是把整页幻灯片扁平化为图片。

编辑器、移动端界面、放映、演讲者工具、导入导出流程以及中英文界面均使用
React 实现。仓库现在使用 Mona 自有的产品测试和确定性测试数据，不再保留第二套
前端框架作为参考运行时。

## 智能代理编辑

Mona 已支持绘图优先和文本优先的演示文稿代理流程。Excalidraw 草图按幻灯片保存，
并可作为视觉意图交给 Mona。代理同时读取原生演示文稿结构和渲染后的幻灯片图像，
生成受限的 JavaScript 演示文稿程序，预览结果、验证命令，并将用户接受的修改作为
一次可撤销事务应用。最终生成的仍是普通、可编辑的演示文稿元素；截图仅用于检查，
不会成为幻灯片数据。

目前支持 OpenAI 帐户登录、Anthropic 帐户登录、用户自带 Google AI Studio 密钥，
以及无需模型即可验证完整编辑流程的本地参考引擎。OAuth 凭据只在代理服务器中加密
保存，不会进入编辑器或生成的演示文稿代码。

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

访问 <http://127.0.0.1:5173/>。根目录的 `dev` 命令会同时启动 React 应用和本地
代理服务器。托管提供商和生产环境密钥要求详见
[`apps/agent-server/README.md`](./apps/agent-server/README.md)。

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
apps/agent-server/           托管提供商、凭据和托管素材的安全边界
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
