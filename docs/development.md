# 开发指南

面向后续开发者（含 AI 代理）的完整技术说明。领域术语见根目录 [CONTEXT.md](../CONTEXT.md)，渲染引擎选型见 [adr/0001-svg-rendering-engine.md](adr/0001-svg-rendering-engine.md)，移动端适配决策见 [adr/0002-mobile-support.md](adr/0002-mobile-support.md)。

## 总览

零依赖纯前端：vanilla JS IIFE 模块 + 浏览器内置能力，无框架、无构建、无包管理。加载顺序（`index.html`）：

```
core.js → icons.js → state.js → render.js → ui.js → presets.js
→ storage.js → exporters.js → panel.js → interact.js → main.js
```

除 `App`（ui.js 导出的全局可变上下文）与各 `Sign*` 命名空间外无全局状态。除 `render.js` 的 draw 函数、`panel.js`、`interact.js` 外均不依赖 DOM，可在 Node 中直接加载测试。

## 核心数据流

```
用户操作
  → App.update(pureFn)            # ui.js：唯一变更入口，pureFn(state) → 新 state（不可变）
    → App.renderAll()             # renderSignInto（SVG 原地重绘）+ overlay + syncRightPanel
      → storage.scheduleAutosave  # 防抖 500ms 写 localStorage，beforeunload 兜底
```

- 状态模型（state.js）：`SignState { widthMode, width, rowHeight, aspectLocked, backgroundColor, rows }`，`Row { id, elements }`，`Element { id, type, props }`。所有操作（增删行/元素、移动、属性合并、序列化/反序列化校验）都是纯函数。
- `App.layout` 缓存最近一次 `layoutSign` 结果，供交互层（落点指示、gap 计算）与设置面板复用。
- 相邻自动内边距：元素属性 `paddingAuto`（新建默认 true，旧存档缺省 false 钉住）。`applyPaddingAuto` 在 App.update 管线中幂等重算——paddingAuto 元素的左/右侧在同行同通道紧邻其他元素（空白占位不算）时取 0.1，否则 0.2；经 `updateElementProps` 写入左右内边距视为手动编辑并钉住（false）。space 恒为 false。
- 选中态（`App.selection.elementId`）不属于 SignState，驱动右栏面板模式（元素属性 / 预设预览 / 标识牌设置）。
- 编辑器偏好（`App.prefs`：`autoLineColor` 自动配色开关、`paletteCity` 选色板城市）同样不属于 SignState（不进项目 JSON），存于 localStorage `sign-prefs`（storage.js `loadPrefs`/`savePrefs`）。城市切换时所有打开中的颜色选择器经 panel.js 的 `paletteCityFns` 观察者同步重建色板；`Core.lineColorFor(号, 城市)` 与 `Core.citySwatches(城市)` 为纯函数，城市表见 core.js `CITY_PALETTES`。

## render.js：metrics / draw 双轨

每个元素类型实现两个函数：

1. **metrics**（纯几何，输入 `(element, rowHeight, measure)`，Node 可测）：输出宽度与该元素全部绘制坐标（基线、色条矩形、分割位置等）。
2. **draw**（消费 metrics 生成 SVG DOM）：签名 `(g, el, mt)`，`mt` 是 `renderElement` 已算好的该元素 metrics。**draw 内不得再调用 metrics 函数**——每个元素每次渲染只测量一次文本，且绘制坐标只有 metrics 一套来源（两处各算一遍迟早漂移）。

两轨共享同一套公式是"所见即所得"的根基——改排版只改 metrics，draw 自动跟随。排版常量移植自参考实现 `sign_jr.py`。

### 排版关键点

- **墨区度量**（core.js `measure.ink` / `measure.ascent` / `measure.descent`）：基于 canvas `actualBoundingBox*`。数字线路的多位排版（`digitLayout`）全部按墨区：首位墨左锚定基准边距 `M=(s−adv₃)/2+lsb₃`、相邻墨区间距 `g=lsb₃+rsb₃`、右侧留白 M——「1」等窄字与其他数字视觉间距一致。数字基线 = 「号线」标签墨区顶 + 自身墨区上升高（顶对齐）。所有文本类元素的大文本统一经 `inkTextLayout`（大文本策略，元素旧名「大数字」，内部类型 id 仍为 `big-number`）排版：多位文本逐字按墨区间距 g 紧排（任意相邻字符间保持 g，混排不重叠），单字符按自身前进宽居中。两种边缘锚定由调用方选择——`edge='lsb'`（首位墨区锚自身字距边距 lsb，独立文本：大数字/编号/文本线路大字）、`edge='margin'`（首位/末位各留基准墨边距 M，紧贴色条：数字线路）。`digitLayout` 为其底层（带字体参数）；FONT_NUM 栈末尾含思源黑体，大文本等元素的中文经栈回退以思源渲染（数字/拉丁仍为 Frutiger）。
- **垂直解剖锚定**（render.js 排版解剖常数）：全文本类元素的**首行墨区顶**统一为 `内容顶 + INK_TOP_LEADING(0.036)×s`，基线 = 墨区顶 + 各自上伸部（中文 CJK_ASC 0.84、英文 cap EN_CAP 0.72、数字 NUM_ASC 0.70，均实测）。双语元素的中文字号 = 字面高意图(0.58s) ÷ 思源墨高比(0.92)（与 506/800 恒等）；同顶内边距 ⇒ 各类型墨区顶齐平（F2）。
- **双语文本对齐**（`bilingualAlignX`）：对齐基准是纯文本区宽度（metrics 的 `textW`），不是含 padding 的元素宽度；英文左右对齐带 `s/30` 光学缩进（移植自参考实现）。
- **箭头**（兼容保留的类型）：8 方向。斜向 = 轴向基底在 `√2s − t` 长的虚拟盒内构建后旋转 ±45°，箭尖锚在盒角、几何不越界；箭柄为四点多边形。
- **图标**：嵌套 `<svg viewBox>` 缩放到内容盒，`fill="black"` 替换为元素颜色（白色保留，tile 风格图标换色正确）。不依赖字体，导出自包含。

### 布局（layoutSign）

- 动态宽度：`width = max(行高, 最宽行)`，所有元素左起流式。
- 固定宽度：支持元素对齐（`props.elementAlign`，left/center/right）——三条独立通道：贴左流式、贴右从右缘流式、居中成组；通道间允许重叠（设计之内，用户调大牌宽解决）。

## 面板刷新：签名 + syncFns

右栏三种模式：元素属性 / 预设预览 / 标识牌设置。`syncRightPanel()` 比较"结构签名"：

- 签名变化 → 重建 DOM（`syncFns` 清空重注册）；
- 签名不变 → 依次执行 `syncFns`（值回显，跳过焦点元素）。

**签名只能含结构性信息**（元素 id、类型、数字线路条数；预设 id 与数量）。设置面板签名是常量 `"settings"`——宽度模式等纯值变化必须走 syncFns 回显。

需要按值回显的控件工厂（`segGroup`/`checkbox`/`bindSync`/颜色选择器）都在**构建时立即 paint 一次**再注册 syncFns——重建路径不执行 syncFns，漏掉构建时 paint 就会出现"改了值但控件无选中态"。

**元素引用过期问题**：面板构建时拿到的 `el` 是快照，任何一次 patch 后即过期（不可变更新）。所有回调与取值必须经 `live()`（按 id 重查 `State.findElement`），否则后一次编辑会用旧值覆盖前一次（历史上正是"数字线路改号跳回默认"的根因）。

## 交互层（interact.js）

- 覆盖层（HTML div）承载行手柄/行按钮/落点指示器，SVG 保持纯净可导出。
- 元素拖拽：mousedown 记录 → 移动超 5px 激活（幽灵副本 + 落点指示）→ mouseup 提交 `State.moveElement`（gap 语义：落点间隙序号，同行向后自动回退一位）。
- 拖拽落点 `dropTargetAt` 按**被拖元素自身**的「元素对齐」通道计算：左/中通道数组序 = 视觉序，按「中点在指针左侧」计数；贴右通道数组序与视觉序相反，按「中点在指针右侧」计数并映射回数组间隙（指示线取通道边界）。混合通道行不可跨通道混算。
- 键盘：Del/Backspace 删除选中元素并取消选中；焦点在输入控件内或模态打开时不拦截。
- 空行删除免确认（无内容可丢）；含元素的行删除仍弹确认对话框。
- 拖拽结束设 `suppressClick` 吞掉紧跟的 click，并用 `setTimeout(0)` 立即过期——若落点与按下点不同元素，浏览器不产生 click，标志不能残留吞掉下一次点击。
- 编辑区显示 `App.fitSignDisplay`：适配画布宽度但缩放不超过 100%（窄标识牌不放大），canvas-wrap 尺寸变化由 ResizeObserver 触发重算。
- 相邻同背景色元素的无缝：元素背景与命中框宽度向上取整、平移向下取整，边界落在整数像素上相互覆盖，消除抗锯齿透明缝。
- 面板头部叉键等用 `hidden` 属性控制的元素，需配套显式 CSS 规则（`.icon-btn` 的 display 会覆盖 UA 的 hidden 规则），新增时同步加 `[hidden]` 样式。

## 移动端适配（≤768px）

断点、布局形态、Pointer 化与缩放的决策记录见 [adr/0002-mobile-support.md](adr/0002-mobile-support.md)。要点：

- **判定**：`App.isMobileView()`（ui.js，`matchMedia('(max-width: 768px)')`），与 style.css 媒体查询、main.js `watchBreakpoint` 共用同一数值。断点跨越时重建 palette、复位 `canvasZoom`、互清理两端折叠态（桌面 `collapsed` ≠ 移动 `band-collapsed`）。断点检测三路兜底：mq change + window resize + `documentElement` ResizeObserver（部分嵌入环境视口变化不派发事件），共用同一幂等检查。
- **布局**：纵向三段式——`#left-panel` 变顶部 chip 行 + 横向卡片条（panel.js `buildPaletteMobile`，`activeCategory` 为模块态跨重建保留；桌面/移动共用 `buildItemCard`/`buildPresetCards` 工厂）；`#right-panel` 变底部属性带（40vh、`.band-collapsed` 折成 48px，`#right-collapse` 兼作把手），选中元素/进预览时 syncRightPanel 自动展开。**仅移动端**点击卡片添加后自动选中新元素（创建元素移到 `App.update` 之前以捕获 id）。移动块内 `#center-panel` 必须 `min-height: 0`：纵向 flex item 默认按内容取最小高度，多行/动态宽的高牌面会把它撑破、把底部属性带挤出视口（删除按钮不可达）——去掉该行即复发（e2e S39 回归覆盖）。
- **事件层**：拖拽（元素/行）全部 Pointer Events，会话锁定 `pointerId`（move/up/cancel 校验一致才处理）；`click` 处理器保留。触屏不在 pointerdown 上 `preventDefault`（防个别浏览器吞 click），滚动抑制靠 `touch-action`（`.hitbox`/`.row-handle` 为 none、卡片 manipulation、移动块内 `#canvas-scroll` 为 none）。**移动端禁用卡片 HTML5 拖拽**（`draggable` 按断点置 false + dragstart preventDefault，见 panel.js `wireCardDrag`）——触屏长按会唤起浏览器原生拖拽会话（卡片置灰、页面收不了场表现为卡死），添加一律走点击。
- **行控件外置**：≤768px 行带内不渲染手柄/按钮（会与牌面元素互相叠加），改由牌面下方 `#row-strip` 行管理条承接（interact.js `renderRowStrip`，每行一枚芯片：▲▼ 按钮调序 / 存预设 / 删行）；断点切换经 `watchBreakpoint` 的 `App.renderAll()` 重渲染。
- **手势**（interact.js 手势段，仅移动布局 + `pointerType === 'touch'`）：`#canvas-scroll` 的 `touch-action: none` 使原生滚动由手势层接管——单指空白拖动=平移（scrollLeft/Top）、双指=pinch（0.5x–4x，锚定两指中点）、空白双击=复位。冲突规则：已激活拖拽会话无视第二指；未激活会话在第二指落下时取消转 pinch。`App.canvasZoom` 是会话态（不持久化），乘进 `fitSignDisplay` 的适配宽度；缩放徽标 `#zoom-badge` 仅移动布局显示。`setPointerCapture` 到滚动容器保证手势期间 DOM 重建不丢事件（合成事件下会抛错，已 try/catch）。
- **生命周期**：自动存档刷盘与实例心跳释放挂在 `beforeunload` + `pagehide` + `visibilitychange(hidden)`（移动端切后台不触发 beforeunload），`visible` 恢复心跳。
- **hover 替代**：`@media (hover: none)` 下行手柄/行按钮常显、手柄内移 `left:8px`、触控目标 44px——该规则实际服务于**宽视口触屏**（如平板的桌面布局）；≤768px 移动布局行控件已外置（见上条），此块对移动端无效（移动 media 块在其后以 display:none 压制）。注意 `hover` 媒体特性反映设备输入能力——带鼠标的桌面机即使窗口 <768px 也不命中；媒体查询无法在桌面仿真验证，e2e 覆盖的是断点逻辑而非 hover:none。

## 测试约定

三套互补，改动后必须全绿：

1. **Node（`node --test`，test/*.mjs）**：状态模型纯函数 + render.js 纯几何。使用确定性假 measurer：`width = len×size×0.9`、`ascent = len×size×0.8`、`ink = { abl:−0.05s, abr:0.85s, adv:0.9s }`。断言按假 measurer 的公式推导。
2. **test.html（浏览器 DOM）**：真实字体下的结构渲染、墨区级间距/对齐断言（墨区顶 = 基线 `y` 属性 − `measure.ascent`；**不能用 getBBox**——Chromium 对 `<text>` 返回行盒）、导出字符串、颜色选择器。需要 getBBox 的用例先把节点挂到 `#fixture`。
3. **e2e.html（iframe 驱动）**：真实交互流（合成 PointerEvent 拖拽、DataTransfer 拖放、模态对话框），覆盖选中/拖拽排序/跨行/预设/面板回显/导出/实例守卫/缩放管线/pagehide 刷盘/移动壳层（S38 收窄 iframe 视口驱动 palette 分支与触屏手势；S39 多行/动态宽高牌面下底部属性带仍在视口内且删除按钮可达）等，结果写 localStorage `e2e-results` 并反映在标题。视口切换处补发 `resize` 事件直达断点检查（嵌入浏览器 iframe 视口变化的事件派发可能被节流推迟，真实设备不受影响）。

HTTP 缓存坑：改完 js 后浏览器可能仍跑旧代码（症状：失败值与修复前逐字节相同）。在页面里 `fetch(url, {cache:'reload'})` 全部改动文件后 reload。

## 新增元素类型清单

1. `state.js`：`ELEMENT_TYPES` 加类型；`DEFAULT_PROPS` 加默认 props（含 `elementAlign`、`padding`）；**必须在 `sanitizeElement` 为新属性补校验**——反序列化是外部数据（导入 JSON / 存档）进入渲染层的唯一闸门，凡渲染层假定过的形状（数组、数值、枚举、字符串）都要收敛，否则一份手改 JSON 就能让整牌渲染崩溃（历史教训见 [code-review-2026-09.md](code-review-2026-09.md) P1-1）。校验对合法值必须是恒等变换，保证 serialize → deserialize 往返不变。
2. `render.js`：metrics 函数 + draw 函数，注册进 `METRICS_FNS` / `DRAW_FNS`。
3. `panel.js`：`TYPE_NAMES` 加名称；类型 switch 加 `build*Fields`（属性控件，取值一律经 `live()`）；需要进左栏则加 `CATEGORIES`；`describeElement` 加描述。
4. `exporters.js`：如使用文本，`collectUsedFonts` 补字体收集。
5. 测试：Node metrics 用例 + test.html 渲染用例（必要时 e2e 场景）。

## 字体管线（构建产物，勿手编）

`fonts/` 与 `fonts-data.js` 由外部原型仓库的 TTF 生成：思源黑体子集化为 GB2312 全量字符（fonttools `subset`，输出 woff2），Helvetica / Frutiger 为数字与西文（TTF）。`fonts-data.js` 是 base64 内嵌数据（约 7MB），导出时懒加载并按需收集 @font-face；编辑态通过 `document.fonts.load` 预载八种字面（font-family 回退栈见 core.js `FONT_LOAD_SPECS`）。

## 图标管线

`js/icons.js` 由 `gen-icons.mjs` 从外部 SVG 目录生成：

```bash
node gen-icons.mjs <图标源目录>   # 源目录含服务设施 *.svg 与 arrows/*.svg
```

生成时剥离 `<defs>` 与 `clip-path`（源文件均为整幅矩形裁剪，视觉无操作）、给无 fill 的绘制元素补 `fill="black"`、`#000` 变体归一。渲染时 `fill="black"` 替换为元素颜色，`fill="white"` 保留（tile 风格图标换色正确）。图标 id→中文名映射在生成脚本的 `NAMES` 表中维护。方向图标（`arrow_*`，12 个）作为左栏「方向指示」卡片；服务设施（17 个）在「服务图标」元素的属性面板中选择。
