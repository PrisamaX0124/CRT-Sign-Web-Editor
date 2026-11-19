# 上传图片并复制地址

1. 在「导出 PNG」旁点「上传到图床…」图标，选择 ImgBB、Freeimage.host 或「两家同时上传」。首次默认选 ImgBB，之后沿用上次选择。
2. 展开「图床设置」，填入密钥。ImgBB 要先登录官网，再在接口页点「Get API key」。Freeimage.host 的公开密钥在官方接口页，并需要填写你信任的 HTTPS 转发地址。可只用 ImgBB。[ImgBB 官方接口页](https://api.imgbb.com/) · [Freeimage.host 官方接口页](https://freeimage.host/api)
3. 点「上传并复制图片地址」。上传使用原尺寸 PNG，ImgBB 上限为 32 MB。第一条成功返回的原图地址会尝试自动复制。每条地址旁都有「复制」，上传失败的一家可以单独「重试」。游戏里可以使用 ImgBB 的 `i.ibb.co` 地址或 Freeimage.host 的 `iili.io` 地址。

密钥默认只在本次打开的页面里有效。勾选「在此浏览器记住」后，下次打开可直接使用。点对应密钥旁的「清除」即可删除。密钥与项目分开保存。

上传中可点「取消上传」，关闭窗口或按 Escape 也会中止正在发送的请求。重新打开后可再次上传，旧请求返回的结果不会影响新上传。已经传完的图片由图床保管，取消本页任务不会删除图床上的图片。

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

转发服务检查浏览器请求的来源，并固定发往 Freeimage.host 的上传接口。来源检查不能代替身份认证。服务还限制请求次数、同时上传数和上传量，超限时返回 429，并通过 `Retry-After` 告知等待秒数。更换本机端口时，同时改 `IMAGE_RELAY_PORT` 和 Caddy 配置里的端口。

默认限制如下，可在启动前用环境变量调整。数值必须为正整数，时间单位为毫秒，上传量单位为字节。上传量包含表单内容，失败请求同样计入次数，已接收的数据也计入上传量。

| 环境变量 | 默认值 | 含义 |
| --- | --- | --- |
| `IMAGE_RELAY_REQUEST_WINDOW` | 60000 | 请求次数的统计时段 |
| `IMAGE_RELAY_REQUEST_LIMIT` | 30 | 每个访问者地址在一个时段内最多请求次数 |
| `IMAGE_RELAY_CONCURRENT_LIMIT` | 4 | 整个服务同时接收和转发的上传数 |
| `IMAGE_RELAY_QUOTA_WINDOW` | 3600000 | 上传量的统计时段 |
| `IMAGE_RELAY_ADDRESS_BYTES` | 268435456 | 每个访问者地址每个时段最多接收 256 MB |
| `IMAGE_RELAY_TOTAL_BYTES` | 1073741824 | 整个服务每个时段最多接收 1 GB |

默认按连接地址计数，不相信客户端填写的 `X-Forwarded-For`。使用上面的本机 Caddy 配置时，启动前设置 `IMAGE_RELAY_TRUSTED_PROXIES=127.0.0.1,::1`，服务才会读取可信转发服务器提供的访问者地址。多个可信地址用逗号分隔。服务从最靠近自己的服务器开始向前检查，避免伪造较早的地址绕过限制。

统计记录保存在当前服务进程中，重启后重新计数。多个服务进程各自计数，部署时应按进程数量分配额度。
