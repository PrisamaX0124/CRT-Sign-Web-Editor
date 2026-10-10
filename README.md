<!-- Modified by PrisamaX0124, 2026-10-06: text lines, custom and Beijing palettes, badge ink fitting, railway icon, station glyphs and public release data separation; see docs/fork-changes.md. -->
# CRT-Sign-Web-Editor

在浏览器里制作轨道交通标识牌，编辑完成后导出 SVG 或 PNG。纯前端，无需安装依赖或构建。

**在线使用：[导向标识牌](https://prisamax0124.github.io/CRT-Sign-Web-Editor/) · [站台吊板与线路图](https://prisamax0124.github.io/CRT-Sign-Web-Editor/platform.html)**

## 两个编辑入口

- **[导向标识牌](index.html)**：组合方向箭头、线路号、双语文字、出入口和服务设施图标，支持多行排版。
- **[站台吊板与线路图](platform.html)**：制作全线吊板、本站吊板，以及纵向单列或双列线路图。切换版式时共用站点、换乘和行车方向数据。

两个页面都支持多选、复制粘贴、撤销重做和预设，也适配手机。文字主要使用 MiSans，数字和线路号使用 Frutiger。

## 开始使用

1. 打开对应页面，添加元素或站点，选中后在右侧修改内容。站台页也可以批量填写站名和换乘信息。
2. 调整尺寸、排版和颜色。内置上海、重庆、成都、北京地铁配色，也可以创建自己的色板。
3. 导出 **PNG** 用作图片或游戏贴图，导出 **SVG** 保留矢量与内嵌字体。需要以后继续编辑时，下载 **项目 JSON**。

编辑内容会自动保存在当前浏览器。换设备或长期保存时，建议另存项目 JSON；常用排版可以存为预设，方便下次复用。

## 本地使用与部署

下载完整目录后，双击 `index.html` 或 `platform.html` 即可使用。请保留 `fonts/` 和 `fonts-export/`，用于字体显示和导出。

也可以运行 `python -m http.server 8000`，然后打开 <http://localhost:8000>。部署到 GitHub Pages 时，选择 `main` 分支的根目录。

开发检查使用 `node --test`。本分支的功能扩展与修复见[修改记录](docs/fork-changes.md)。

## 来源与许可

本项目基于 [endcreeper861/JR-Guidance-Sign-Web-Editor](https://github.com/endcreeper861/JR-Guidance-Sign-Web-Editor) 修改，保留原作者历史，代码沿用 [Apache License 2.0](LICENSE)。来源说明见 [NOTICE](NOTICE)。

MiSans、Frutiger 字体由用户提供；服务设施和方向图标来自 signmaker-main，中国铁路图标按提供的路徽整理。字体、图标等第三方素材遵循各自的授权。
