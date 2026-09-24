# JR-Guidance-Sign-Web-Editor

**在线使用：** <https://endcreeper861.github.io/JR-Guidance-Sign-Web-Editor/>

JR风格导向标识牌 Web 编辑器。类似国内的重庆轨道交通（CRT）、成都地铁风格，但不完全相同。

打开 `index.html` 即可使用，所见即所得地编辑由多行元素组成的导向标识牌，并导出为自包含的 SVG / PNG。

> 项目从Python原型 `sign_jr.py`（Pillow 位图渲染）迁移而来，渲染比例与排版规则均移植自该参考实现。领域术语与设计决策见 [CONTEXT.md](CONTEXT.md) 与 [docs/](docs/)。

## 功能特性

- **元素**：方向图标（12 向，含前方向左/右、左右行向后）、数字线路（多线路、色条自动配色）、文本线路（贯穿色条 + 大字 + 线/英文名，可关闭「线路名下沉」改与「线」同字号完整显示）、双语文本（中英双语三种对齐）、大文本（任意文本的大号展示，旧名「大数字」）、出入口、出口（出口黄底）、服务设施图标（电梯/洗手间/楼梯等 17 种）、空白占位。
- **标识牌**：行高统一、行数不限；宽度支持固定 / 动态（最宽行决定）两种模式，可锁定宽高比。
- **城市配色**：选色板线路配色支持上海 / 重庆 / 成都快捷切换（在任意颜色选择器顶部）；多条线路共用的颜色合并为一个色块（如重庆潘通 2935C 蓝）；「输入线路号自动匹配线路色」可在标识牌设置 → 编辑器中开关，按当前城市线路表填充。
- **内容对齐**：数字线路、文字线路、出口支持元素内左/右对齐（属性 `align`），右对齐时色块移至右缘、出口编号移至「出口」右侧，贴合现实右置导视牌；数字线路右对齐仅渲染第 1 条线路。与固定宽度模式的元素对齐相互独立。
- **固定宽度元素对齐**：元素可贴左 / 居中 / 贴右，三条通道独立排列（可能重叠，属设计之内，调大牌宽解决）；动态宽度模式下整体左起排列。
- **相邻自动内边距**：元素开启「随相邻自动缩放」时，左右内边距在紧邻其他元素的一侧自动减半（0.2 ↔ 0.1），删除邻居自动恢复；手动修改即固定。空白占位不算邻居。
- **墨区排版**：数字线路的数字间距、首位与色条的间距均按字形墨区（`actualBoundingBox*`）计算，「1」等窄字与其他数字视觉间距一致；数字与「号线」标签墨区顶对齐。
- **灰框**：可为标识牌开启自定义宽度的灰色直角边框（牌面边缘向内延伸，覆盖于内容之上），每一行独立成框，模拟真实标识牌的金属边框效果；随 SVG/PNG 一同导出。
- **导出**：SVG 内嵌 @font-face 字体（按需收集），PNG 按标识牌像素尺寸光栅化，任意环境打开视觉一致。
- **自动保存**：localStorage 防抖落盘，刷新恢复；多标签页实例守卫。
- **预设**：任意行可保存为预设，拖入空行复用。

## 本地运行

无需安装任何依赖：

```bash
# 直接双击 index.html，或起一个静态服务器：
python -m http.server 8000
# 浏览器打开 http://localhost:8000
```

## 测试

```bash
node --test          # 状态模型 + 纯几何（Node 内置 test runner，无依赖）
```

- `test.html` —— 浏览器 DOM 测试（真实字体下的墨区级断言、渲染结构、导出）
- `e2e.html` —— iframe 驱动的端到端交互测试（选中/拖拽/面板/导出等），结果同时写入 localStorage

## 图标库再生成

图标数据内嵌于 `js/icons.js`（源为另一项目的服务设施与方向 SVG）。源图标更新后重新生成：

```bash
node gen-icons.mjs <图标源目录>   # 目录下含 *.svg 与 arrows/*.svg
```

## 部署（GitHub Pages）

纯静态站点，`index.html` 位于仓库根目录。仓库 Settings → Pages → 从分支根目录部署即可。

## 目录结构

```txt
index.html            应用入口
style.css             全部样式
js/                   应用代码（IIFE 模块，加载顺序见 index.html）
  core.js             常量/工具/字体度量/文本测量（含墨区度量）
  icons.js            图标库数据（生成物，勿手编）
  state.js            SignState 纯函数状态模型（不可变）
  render.js           SVG 渲染引擎（metrics 纯几何 + draw DOM 双轨）
  ui.js               全局 App 上下文、toast/模态、DOM 工具
  panel.js            左栏元素选择区 + 右栏属性/设置面板
  interact.js         编辑区交互（选中/拖拽/落点指示/行管理）
  presets.js          行预设（localStorage）
  storage.js          自动保存/实例守卫/项目 JSON 导入导出
  exporters.js        SVG/PNG 导出（内嵌字体）
  main.js             启动装配（字体预加载 → 恢复状态 → 首帧）
fonts/                字体文件（构建产物）
fonts-data.js         字体 base64 内嵌数据（构建产物，导出时懒加载）
gen-icons.mjs         图标库生成脚本
test.html / e2e.html  浏览器测试页
test/                 Node 单元测试
docs/                 开发文档（ADR、开发指南）
CONTEXT.md            领域术语表
AGENTS.md             AI 协作指引
LICENSE               开源协议文件（Apache-2.0）
```

## 文档

| 文档 | 内容 |
| --- | --- |
| [CONTEXT.md](CONTEXT.md) | 领域术语表（标识牌/行/元素/元素对齐/图标等，含"避免用词"） |
| [docs/development.md](docs/development.md) | 开发指南：架构、状态流、新增元素类型清单、字体与图标管线、测试约定 |
| [docs/adr/0001-svg-rendering-engine.md](docs/adr/0001-svg-rendering-engine.md) | ADR：为什么选 SVG 作为渲染引擎 |
| [docs/code-review-2026-09.md](docs/code-review-2026-09.md) | 代码审阅记录：隐患清单、修改措施与"审阅过但不改"的决策 |
| [AGENTS.md](AGENTS.md) | AI 协作快速上手 |

## 字体与图标来源

- `fonts/` 与 `fonts-data.js` 为构建产物：思源黑体子集化（GB2312 全量字符，fonttools 生成）+ Helvetica / Frutiger（数字与西文）。**不要手工编辑**，再生成管线见 [docs/development.md](docs/development.md)。
- 服务设施与方向图标移植自 signmaker-main 项目的 `icon` 目录，已内嵌为 SVG path 数据。

## 开源协议

本项目采用 [Apache License 2.0](LICENSE) 开源协议。

