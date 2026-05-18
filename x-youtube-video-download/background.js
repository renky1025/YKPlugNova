'use strict';

const tabMedia = new Map();
const popupPorts = new Set();
let nativePort = null;
let activeDownload = null;

function createTabRecord() {
  return {
    urls: new Set(),
    mediaEntries: new Map(),
    pageTitle: '',
    currentEpisode: '',
    episodeUpdatedAt: 0,
    videoMetas: [],
  };
}

function upsertMediaEntry(record, url, lastSeenAt = Date.now()) {
  if (!isValidHttpUrl(url)) return;
  record.urls.add(url);
  const prev = record.mediaEntries.get(url);
  record.mediaEntries.set(url, {
    url,
    lastSeenAt: Math.max(prev?.lastSeenAt || 0, lastSeenAt || 0),
  });
}

function buildMediaItems(record) {
  const items = Array.from(record.mediaEntries.values())
    .filter(item => isValidHttpUrl(item.url))
    .sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0));

  const latestItem = items[0];
  return items.map((item, index) => ({
    url: item.url,
    lastSeenAt: item.lastSeenAt,
    episodeText: (
      index === 0
      && latestItem
      && record.currentEpisode
      && record.episodeUpdatedAt
      && (latestItem.lastSeenAt || 0) >= record.episodeUpdatedAt
    ) ? record.currentEpisode : '',
  }));
}

function cloneDownloadState() {
  return activeDownload ? JSON.parse(JSON.stringify(activeDownload)) : null;
}

function persistDownloadState() {
  chrome.storage.local.set({ activeDownload }).catch(() => {});
}

function setActiveDownload(nextState) {
  activeDownload = nextState;
  persistDownloadState();
  broadcastToPopups({ type: 'download_state', state: cloneDownloadState() });
}

function updateActiveDownload(patch) {
  if (!activeDownload) return;
  setActiveDownload({ ...activeDownload, ...patch });
}

chrome.storage.local.get('activeDownload').then((stored) => {
  if (stored?.activeDownload) activeDownload = stored.activeDownload;
}).catch(() => {});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup') {
    popupPorts.add(port);
    try {
      port.postMessage({ type: 'download_state', state: cloneDownloadState() });
    } catch (e) {}
    port.onDisconnect.addListener(() => popupPorts.delete(port));
  }
});

function broadcastToPopups(msg) {
  popupPorts.forEach(port => {
    try { port.postMessage(msg); } catch (e) {}
  });
}

function getNativePort() {
  if (!nativePort) {
    try {
      nativePort = chrome.runtime.connectNative('com.signalfoundry.downloadapp');
      nativePort.onMessage.addListener((msg) => {
        if (msg.type === 'progress') {
          if (activeDownload?.status === 'running') {
            updateActiveDownload({
              stage: msg.stage,
              current: msg.current,
              total: msg.total,
              message: msg.message,
              updatedAt: Date.now(),
            });
          }
          broadcastToPopups({ type: 'progress', stage: msg.stage, current: msg.current, total: msg.total, message: msg.message });
        }
      });
      nativePort.onDisconnect.addListener(() => {
        const err = chrome.runtime.lastError;
        if (err) {
          if (activeDownload?.status === 'running') {
            updateActiveDownload({
              status: 'failed',
              error: err.message || 'Native host disconnected',
              updatedAt: Date.now(),
            });
          }
          broadcastToPopups({ type: 'native_error', message: err.message || 'Native host disconnected' });
        }
        nativePort = null;
      });
    } catch (e) {
      return null;
    }
  }
  return nativePort;
}

function isValidHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch (e) {
    return false;
  }
}

// Intercept network media URLs
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId > 0) {
      const url = details.url;
      if (url && /\.(m3u8|mp4|mpd|m4s)(\?|$)/i.test(url) && isValidHttpUrl(url)) {
        const record = tabMedia.get(details.tabId) || createTabRecord();
        upsertMediaEntry(record, url, details.timeStamp || Date.now());
        tabMedia.set(details.tabId, record);
      }
    }
  },
  { urls: ['<all_urls>'], types: ['xmlhttprequest', 'media', 'other'] }
);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'page_media') {
    if (sender.tab?.id) {
      const record = tabMedia.get(sender.tab.id) || createTabRecord();
      const collectedAt = msg.collectedAt || Date.now();
      (msg.urls || []).forEach(u => {
        upsertMediaEntry(record, u, collectedAt);
      });
      if (msg.pageTitle) record.pageTitle = msg.pageTitle;
      if (msg.currentEpisode && (msg.currentEpisodeUpdatedAt || 0) >= (record.episodeUpdatedAt || 0)) {
        record.currentEpisode = msg.currentEpisode;
        record.episodeUpdatedAt = msg.currentEpisodeUpdatedAt || collectedAt;
      }
      if (msg.videoMetas) record.videoMetas = msg.videoMetas;
      tabMedia.set(sender.tab.id, record);
    }
    return false;
  }

  if (msg.type === 'get_detected_urls') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      const record = tabMedia.get(tabId) || createTabRecord();
      const pageUrl = tabs[0]?.url || '';
      const mediaItems = buildMediaItems(record);
      sendResponse({
        urls: mediaItems.map(item => item.url),
        mediaItems,
        pageUrl: isValidHttpUrl(pageUrl) ? pageUrl : '',
        pageTitle: record.pageTitle,
        currentEpisode: record.currentEpisode,
        videoMetas: record.videoMetas,
      });
    });
    return true;
  }

  if (msg.type === 'get_download_state') {
    sendResponse({ success: true, state: cloneDownloadState() });
    return false;
  }

  if (msg.type === 'download') {
    if (activeDownload?.status === 'running') {
      sendResponse({ success: false, error: '已有下载任务正在进行' });
      return false;
    }

    const port = getNativePort();
    if (!port) {
      sendResponse({ success: false, error: '无法连接本地下载服务' });
      return false;
    }
    const taskId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const listener = (response) => {
      if (response.type === 'result' && response.cmd === 'download') {
        port.onMessage.removeListener(listener);
        updateActiveDownload({
          status: 'completed',
          artifacts: response.artifacts,
          message: '下载完成',
          updatedAt: Date.now(),
        });
      } else if (response.type === 'error') {
        port.onMessage.removeListener(listener);
        if (activeDownload?.status === 'cancelled') {
          updateActiveDownload({ updatedAt: Date.now() });
          return;
        }
        updateActiveDownload({
          status: 'failed',
          error: response.message,
          updatedAt: Date.now(),
        });
      }
    };
    port.onMessage.addListener(listener);
    setActiveDownload({
      taskId,
      status: 'running',
      request: msg.request,
      stage: 'prepare',
      current: 0,
      total: 0,
      message: '已提交下载任务',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      artifacts: null,
      error: '',
    });
    port.postMessage({ cmd: 'download', request: msg.request });
    sendResponse({ success: true, taskId });
    return false;
  }

  if (msg.type === 'cancel') {
    const port = getNativePort();
    if (port) port.postMessage({ cmd: 'cancel' });
    if (activeDownload?.status === 'running') {
      updateActiveDownload({
        status: 'cancelled',
        message: '已请求取消',
        updatedAt: Date.now(),
      });
    }
    sendResponse({ success: true });
    return false;
  }
  if (msg.type === 'clear_download_state') {
    // 仅在非 running 状态时清理，防止误清活跃任务
    if (!activeDownload || activeDownload.status !== 'running') {
      setActiveDownload(null);
    }
    sendResponse({ success: true });
    return false;
  }

  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => tabMedia.delete(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') tabMedia.delete(tabId);
});
