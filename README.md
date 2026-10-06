<!-- Modified by PrisamaX0124, 2026-10-06: text lines, custom and Beijing palettes, badge ink fitting, railway icon, station glyphs and public release data separation; see docs/fork-changes.md. -->
# CRT-Sign-Web-Editor

**在线使用：** [导向标识牌](https://prisamax0124.github.io/CRT-Sign-Web-Editor/) · [站台吊板与线路图](https://prisamax0124.github.io/CRT-Sign-Web-Editor/platform.html)

本项目由 [endcreeper861/JR-Guidance-Sign-Web-Editor](https://github.com/endcreeper861/JR-Guidance-Sign-Web-Editor) Fork 而来，保留原作者历史并沿用 [Apache License 2.0](LICENSE)。

纯前端、零依赖、无需构建。导向标识牌支持多行编辑、配色、尺寸、多选、剪贴板、预设及 SVG / PNG 导出；站台页提供全线吊板、本站吊板及纵向单列 / 双列线路图，共用站点、换乘和行车方向数据。

配色支持上海、重庆、成都、北京地铁；北京的19项线路色按用户提供色卡的HEX列录入。展开任意颜色控件并点击「管理自定义色板」，可新建、复制当前配色、编辑名称与HEX、调整顺序、保存并使用；两个页面共用同一浏览器中的色板，并支持导入 / 导出JSON跨设备使用。

新建站台项目从一个可编辑站点开始；添加站点或批量填写自己的站名与换乘即可使用。项目与用户自行保存的预设仅存于当前浏览器，也可保存项目 JSON 跨设备使用。

站台线路号可输入文字名称；「添加文字换乘线路」支持中英文名称与颜色，批量格式为 `机场线~Airport Line:#0057B8`。文字线路使用 MiSans Regular，换乘色块与数字圆标同高。主线路圆标按实际墨区、圆边和分隔线留白缩放，支持多个中文字。纵向12起站号继续使用01–11的参考数字轮廓。导向标识的服务设施库新增「中国铁路」，外框为无填充、黑色1磅的圆角矩形。

## 使用与部署

打开 index.html 或 platform.html。请保留 fonts/ 和 fonts-export/，以保证字体与导出完整。GitHub Pages 从 main 分支根目录部署，两页通过入口链接相互切换。

本地也可运行静态服务器，开发验证使用 node --test。公开版的状态与三种版式几何测试位于 test/public.test.mjs。

## 字体、图标与来源

MiSans Regular / Semibold / Bold 由用户提供，Frutiger 用于大文本、数字线路号与出入口编号；保留原字体文件与生成的导出资源。既有服务设施与方向图标移植自 signmaker-main 项目的 icon 目录，沿用上游生成的图标数据；中国铁路路徽按用户提供的图片整理为自包含矢量图标。

代码修改说明见 [docs/fork-changes.md](docs/fork-changes.md)，项目来源见 [NOTICE](NOTICE)。第三方字体、图标等素材遵循各自的授权，不因本仓库的代码协议改变。
