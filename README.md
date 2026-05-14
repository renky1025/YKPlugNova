# YKPlugNova

A collection of Chrome extension tools (Manifest V3).

---

## 1. Twitter/X Bilingual Reply Assistant
![AI auto-reply](/assets/autoreply.png)
`twitter-reply-ai-assistant/`

Extract tweets and generate bilingual (Chinese/English) replies with one click via AI.

- Supports OpenAI, Claude, custom API endpoints
- API keys stored locally only, privacy-first
- No build step required — load as unpacked extension directly

[Details →](twitter-reply-ai-assistant/README.md)

---

## 2. DownloadApp — Video Downloader
![One-click video download](/assets/autodownload.png)
`x-youtube-video-download/`

Detect video resources (HLS / MP4 / DASH) on a page and download, decrypt, and mux them through a local Python service.

- M3U8 multi-threaded segmented download + AES-128 decryption
- YouTube / Twitter / Bilibili direct download (yt-dlp)
- Real-time progress and logs, cancellation supported
- Requires Native Messaging Host installation

[Details →](x-youtube-video-download/README.md)

---

## General Installation

All extensions are loaded via Chrome developer mode:

1. Open `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the extension's directory

Each extension may have additional dependencies (e.g. API key or Native Host). See their respective README for details.
