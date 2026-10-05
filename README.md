<!-- Modified by PrisamaX0124, 2026-10-05: public release data and storage separation; see docs/fork-changes.md. -->
# CRT-Sign-Web-Editor

**在线使用：** [导向标识牌](https://prisamax0124.github.io/CRT-Sign-Web-Editor/) · [站台吊板与线路图](https://prisamax0124.github.io/CRT-Sign-Web-Editor/platform.html)

本项目由 [endcreeper861/JR-Guidance-Sign-Web-Editor](https://github.com/endcreeper861/JR-Guidance-Sign-Web-Editor) Fork 而来，保留原作者历史并沿用 [Apache License 2.0](LICENSE)。

纯前端、零依赖、无需构建。导向标识牌支持多行编辑、配色、尺寸、多选、剪贴板、预设及 SVG / PNG 导出；站台页提供全线吊板、本站吊板及纵向单列 / 双列线路图，共用站点、换乘和行车方向数据。

配色支持上海、重庆、成都。新建站台项目从一个可编辑站点开始；添加站点或批量填写自己的站名与换乘即可使用。项目与用户自行保存的预设仅存于当前浏览器，也可保存项目 JSON 跨设备使用。

## 使用与部署

打开 index.html 或 platform.html。请保留 fonts/ 和 fonts-export/，以保证字体与导出完整。GitHub Pages 从 main 分支根目录部署，两页通过入口链接相互切换。

本地也可运行静态服务器，开发验证使用 node --test。公开版的状态与三种版式几何测试位于 test/public.test.mjs。

## 字体、图标与来源

MiSans Regular / Semibold / Bold 由用户提供，Frutiger 用于大文本、线路号与出入口编号；保留原字体文件与生成的导出资源。服务设施与方向图标移植自 signmaker-main 项目的 icon 目录，沿用上游生成的图标数据。

代码修改说明见 [docs/fork-changes.md](docs/fork-changes.md)，项目来源见 [NOTICE](NOTICE)。第三方字体、图标等素材遵循各自的授权，不因本仓库的代码协议改变。
