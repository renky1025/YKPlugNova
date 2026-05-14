# Chrome 插件集

本仓库包含以下 Chrome 浏览器扩展（Manifest V3）：

---

## 1. Twitter/X 双语回复助手

`twitter-reply-ai-assistant/`

提取 Twitter/X 帖子内容，调用 AI 一键生成中英文双语回复。

- 支持 OpenAI、Claude、自定义 API
- API Key 仅存储在本地，隐私安全
- 无需构建步骤，直接加载为未打包扩展

[查看详情 →](twitter-reply-ai-assistant/README.md)

---

## 2. DownloadApp 视频下载插件

`x-youtube-video-download/`

探测页面中的视频资源（HLS / MP4 / DASH），通过本地 Python 服务完成下载、解密和混流。

- 支持 M3U8 多线程分段下载 + AES-128 解密
- 支持 YouTube / Twitter / Bilibili 直接下载（yt-dlp）
- 实时进度与日志，支持取消
- 需安装 Native Messaging Host

[查看详情 →](x-youtube-video-download/README.md)

---

## 通用安装步骤

所有插件均通过 Chrome 开发者模式加载：

1. 打开 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择对应插件目录

各插件可能有额外依赖（如 API Key 或 Native Host），请参考各自的 README。
