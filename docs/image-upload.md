# 上传图片并复制地址

1. 在「导出 PNG」旁点「上传图片」，选择 ImgBB、Freeimage.host 或「两家同时上传」。首次默认选 ImgBB，之后沿用上次选择。
2. 展开「图床设置」，填入密钥。ImgBB 要先登录官网，再在接口页点「Get API key」。Freeimage.host 的公开密钥在官方接口页，并需要填写你信任的 HTTPS 转发地址。可只用 ImgBB。[ImgBB 官方接口页](https://api.imgbb.com/) · [Freeimage.host 官方接口页](https://freeimage.host/api)
3. 点「上传并复制图片地址」。上传使用原尺寸 PNG，ImgBB 上限为 32 MB。第一条成功返回的原图地址会尝试自动复制。每条地址旁都有「复制」，上传失败的一家可以单独「重试」。游戏里可以使用 ImgBB 的 `i.ibb.co` 地址或 Freeimage.host 的 `iili.io` 地址。

密钥默认只在本次打开的页面里有效。勾选「在此浏览器记住」后，下次打开可直接使用。点对应密钥旁的「清除」即可删除。密钥与项目分开保存。

## 启动 Freeimage.host 转发服务

编辑器仍发布在 GitHub Pages。转发服务在你自己的服务器上运行，会收到图片和密钥。

1. 在服务器上安装 Node.js 24 或更新版本。在仓库根目录运行以下命令。把 `EDITOR_ORIGIN` 改成编辑器网址的协议、域名和端口，去掉末尾斜杠和项目路径。若在本机调试，可把它设为 `http://localhost:8000`，并从这个地址打开编辑器。

   PowerShell

   ```powershell
   $env:EDITOR_ORIGIN = 'https://prisamax0124.github.io'
   node server/freeimage-relay.mjs
   ```

   Bash

   ```bash
   EDITOR_ORIGIN=https://prisamax0124.github.io node server/freeimage-relay.mjs
   ```

2. 服务默认监听本机的 `127.0.0.1:8787`。用 Caddy 或现有的网页服务器提供 HTTPS。以下是 Caddy 配置示例。把 `upload.example.com` 换成指向该服务器的域名，并开放 80 和 443 端口以便 Caddy 申请证书。[Caddy 的 HTTPS 配置](https://caddyserver.com/docs/automatic-https) · [Caddy 的转发配置](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)

   ```caddyfile
   upload.example.com {
       reverse_proxy /freeimage 127.0.0.1:8787
   }
   ```

   把配置保存为 `Caddyfile`，运行 `caddy run --config ./Caddyfile`。

3. 在「图床设置」中填写 `https://upload.example.com/freeimage`，域名用你刚配置的域名。要检查配置，可从该编辑器页面选择 Freeimage.host 上传一张标识牌，确认结果出现 `https://iili.io/` 开头的原图地址。

转发服务只接收来自指定编辑器网站的浏览器请求，固定发往 Freeimage.host 的上传接口。更换本机端口时，同时改 `IMAGE_RELAY_PORT` 和 Caddy 配置里的端口。
