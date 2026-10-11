<!-- Modified by PrisamaX0124, 2026-10-11: 修复一些 AI 语病和非人类表述。 -->
# CRT-Sign-Web-Editor

一个仿[重庆轨道交通](https://zh.wikipedia.org/wiki/重庆轨道交通)风格的导视牌网页编辑器。

可以直接在浏览器里制作导向标识牌、站台吊板和线路图，完成后导出 SVG 或 PNG。纯前端，无需安装依赖或构建。

## 在线使用

### [导向标识牌](https://prisamax0124.github.io/CRT-Sign-Web-Editor/) · [站台吊板与线路图](https://prisamax0124.github.io/CRT-Sign-Web-Editor/platform.html)

这个项目原本是我在自己的 Minecraft 建筑服务器 [GrandMaster Craft Supported by K2Lin](https://chinadlrs.com/mc/3) 里制作轨道交通导视牌的自用工具。

后来陆续补充了一些功能，并加入了站台吊板和纵向线路图编辑器，就整理成了现在的开源版本。

希望能方便有类似需求的人使用，比如同样在 Minecraft 里建设轨道交通的玩家。

两个编辑页面均已适配移动端，并支持电脑端快捷键操作。中英文字体主要使用 MiSans，数字和线路号使用 Frutiger。


<img width="1280" height="675" alt="image" src="https://github.com/user-attachments/assets/662173bf-2bb4-4377-b422-54499e59859e" />

*（↑ 在 GrandMaster Craft Supported by K2Lin 旧世界轨道交通 4/10号线 上云岭站中的实际使用效果）*


## 如何使用？

1. 打开对应页面，添加元素或站点，选中后在右侧修改内容。站台页也可以批量填写站名和换乘信息。
2. 调整尺寸、排版和颜色。内置上海、重庆、成都、北京地铁配色，默认输入线路号自动匹配颜色，也可以自己创建色板。
3. 导出 **PNG** 用作图片或游戏贴图，也支持导出 **SVG** 保留矢量与内嵌字体。需要以后继续编辑时，也可以下载 **项目 JSON**。

编辑内容会自动保存在当前浏览器中。换设备或长期保存时，建议另存项目 JSON；常用排版可以存为预设，方便下次复用。

## 本地部署

下载完整目录后，双击 `index.html` 或 `platform.html` 即可使用。请保留 `fonts/` 和 `fonts-export/`，用于字体显示和导出。

也可以运行 `python -m http.server 8000`，然后打开 <http://localhost:8000>。部署到 GitHub Pages 时，选择 `main` 分支的根目录。

开发检查使用 `node --test`。本分支的功能扩展与修复见[修改记录](docs/fork-changes.md)。

## 来源与许可

本项目基于 [endcreeper861/JR-Guidance-Sign-Web-Editor](https://github.com/endcreeper861/JR-Guidance-Sign-Web-Editor) 修改，保留原作者历史，代码沿用 [Apache License 2.0](LICENSE)。来源说明见 [NOTICE](NOTICE)。

MiSans 字体（由小米推出，可按 [《MiSans 字体知识产权许可协议》](https://hyperos.mi.com/font-download/MiSans字体知识产权许可协议.pdf) 免费使用及商用）；Frutiger 字体由原仓库提供；服务设施和方向图标来自 [signmaker-main](https://github.com/hcrk9/signmaker/) ，中国铁路图标按提供的路徽整理。字体、图标等第三方素材遵循各自的授权，不因本仓库的代码开源而改变。

## 致谢

感谢重庆轨道交通导视系统的设计者，这些导视牌的设计是这个编辑器主要的参考。
也感谢原作者 [endcreeper861](https://github.com/endcreeper861) 开源 [JR-Guidance-Sign-Web-Editor](https://github.com/endcreeper861/JR-Guidance-Sign-Web-Editor)，让我能在原作的基础上继续修改，做成现在这个编辑器。
