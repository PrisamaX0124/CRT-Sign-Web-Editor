# AGENTS.md — AI 协作指引

面向无上下文的 AI 代理（Claude Code / ZCode 等）的仓库快速上手。改代码前请先读 [docs/development.md](docs/development.md) 与 [CONTEXT.md](CONTEXT.md)。

## 这个仓库是什么

上海地铁风格导向标识牌 Web 编辑器。**纯前端、零依赖、无构建**——vanilla JS IIFE 模块 + 浏览器内置能力，`index.html` 即入口，可直接静态托管（GitHub Pages）。

## 改代码前必读的约定

- **不可变状态**：所有状态变更是 `state.js` 中的纯函数（返回新对象），入口是 `App.update(pureFn)`；变更后自动全量重渲染 + 防抖落盘。禁止原地修改状态。
- **metrics / draw 双轨**：每个元素类型在 `render.js` 有一个 metrics 纯几何函数（Node 可测，输出宽度与全部绘制坐标）和一个 draw 函数（消费 metrics 生成 SVG DOM）。**二者必须共享同一套公式**，保证所见即所得。排版常量移植自参考实现 `sign_jr.py`（中文字号 ×506/800、英文 ×285/800、数字 ×1.3、色条 ×10/28），改动前先对照。
- **墨区排版**：文字间距/对齐按字形墨区（`measure.ink` / `measure.ascent`，基于 canvas `actualBoundingBox*`）计算，不按字距宽度。注意 SVG `getBBox()` 对 `<text>` 返回**行盒而非墨区**，验证墨区要用「`y` 属性 − `measure.ascent`」。
- **面板刷新机制**：右栏面板按"结构签名"决定重建还是值同步（`syncFns`）。签名必须只含结构性信息（元素 id/类型/线路条数），**不得包含可编辑的值**——否则每次编辑都重建面板且重建出的控件不带选中态。需要按值回显的控件：构建时立即 paint + 注册 syncFns。同一"值变更不动结构"原则适用于移动端顶部 palette：切换元素分类只翻 chip 的 active 态 + 就地替换卡片条（`selectPaletteCategory`），不整树重建——否则 chip 行的横向滑动位置被重置（e2e S40）。
- **过期快照**：面板构建时捕获的元素引用在第一次 patch 后即过期（不可变更新）。所有回调/值同步必须经 `live()`（按 id 重查当前元素），否则编辑互相回滚。
- **生成物勿手编**：`js/icons.js`（由 `gen-icons.mjs` 生成）、`fonts/`、`fonts-data.js`（思源黑体子集 + 西文字体，fonttools 管线在外部原型仓库）。

## 测试（改动后必须全绿）

```bash
node --test                        # 状态 + 纯几何（假 measurer，Node 内置 runner）
# 浏览器打开 test.html             # DOM + 真实字体墨区断言（标题应为 ✔ 全部通过）
# 浏览器打开 e2e.html              # 端到端交互（标题应为 ✔ E2E 全部通过）
```

- 本地起服务：`python -m http.server 8000`（file:// 下部分能力受限，建议 http）。
- Node 测试用确定性假 measurer（`width=len×size×0.9`、`ascent=0.8×size×len`、`ink` 按比例），**真实字体下的视觉断言**放 test.html。
- 修改渲染后浏览器可能命中 HTTP 缓存跑旧代码：在页面里 `fetch(url, {cache:'reload'})` 全部改动脚本后 reload。
- TDD：先写能变红的回归测试（对应用户描述的确切症状），再修，再全绿。

## 文档地图

| 文档 | 内容 |
| --- | --- |
| docs/development.md | 架构详解、状态流、新增元素类型清单、字体/图标管线 |
| CONTEXT.md | 领域术语表（含避免用词） |
| docs/adr/ | 架构决策记录（0001：SVG 渲染引擎） |
| docs/code-review-2026-09.md | 代码审阅记录：隐患清单、修改措施与"审阅过但不改"的决策 |
| README.md | 面向使用者的介绍与部署说明 |
