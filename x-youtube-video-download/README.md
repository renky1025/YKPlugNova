# DownloadApp Chrome 扩展

通过 Chrome 扩展探测页面视频并调用本地下载服务完成 HLS / MP4 / 直接下载。

## 功能

1. **页面探测** — 点击扩展图标，自动探测当前页面中的视频资源（M3U8、MP4、DASH 等）。
2. **候选列表** — 展示探测到的所有候选，包括平台、类型、分辨率、码率和评分。
3. **一键下载** — 选择候选后点击下载，由本地 Native Host 调用 `downloadapp/core/` 完成：
   - HLS 主清单/媒体清单解析
   - 多线程分片下载
   - AES-128 解密
   - 音视频混流（ffmpeg）
   - YouTube / Twitter / Bilibili 直接下载（yt-dlp）
4. **进度与日志** — 实时显示下载进度和详细日志，支持取消任务。

## 架构

```
Chrome 扩展（JS）                本地下载服务（Python）
├─ content.js      ──页面URL──>  ├─ downloadapp_host.py
├─ background.js    ──Native──>  │   ├─ probe_page()
├─ popup.js        ──Messaging─> │   ├─ HlsDownloader
└─ popup.html                    │   └─ DirectDownloader
```

扩展本身不处理下载、解密和混流；所有核心逻辑复用 `downloadapp/core/` 模块，通过 Native Messaging 通信。

## 安装

### 1. 确保依赖已安装

```bash
# 在 downloadapp 项目根目录
pip install -r requirements.txt  # requests, pycryptodome, PyQt6 等
# 确保 ffmpeg 和 yt-dlp 在 PATH 中
ffmpeg -version
yt-dlp --version
```

### 2. 安装 Native Host

```bash
cd chrome-extension/native-host
./install_host.sh
```

脚本会将 `com.signalfoundry.downloadapp.json` 写入 Chrome 的 `NativeMessagingHosts` 目录。

### 3. 加载扩展

1. 打开 Chrome，进入 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `downloadapp/chrome-extension/` 文件夹
5. 记住扩展 ID（应为 `lnbmpcpenlogffmnbckimmoebnjbfnpb`，因为 manifest 中已固定 key）

### 4. 验证

打开任意包含视频的页面，点击扩展图标，点击「探测视频」。

## 文件说明

| 文件 | 说明 |
|---|---|
| `manifest.json` | Manifest V3，声明权限和入口 |
| `content.js` | 内容脚本，提取 video 标签、全局变量、Performance 资源 |
| `background.js` | Service Worker，拦截媒体请求、管理 Native Port |
| `popup.html/js/css` | 弹出窗口 UI，探测、列表、下载、进度、日志 |
| `native-host/downloadapp_host.py` | Native Messaging Host，stdio JSON 协议 |
| `native-host/install_host.sh` | macOS/Linux 安装脚本 |

## 卸载

1. 在 `chrome://extensions/` 中移除扩展
2. 删除 Native Host manifest：
   - macOS: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.signalfoundry.downloadapp.json`
   - Linux: `~/.config/google-chrome/NativeMessagingHosts/com.signalfoundry.downloadapp.json`
