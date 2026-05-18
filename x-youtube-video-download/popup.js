document.addEventListener('DOMContentLoaded', () => {
  const els = {
    status: document.getElementById('status'),
    probeBtn: document.getElementById('probe-btn'),
    directDownloadBtn: document.getElementById('direct-download-btn'),
    detectedHint: document.getElementById('detected-hint'),
    candidatesSection: document.getElementById('candidates-section'),
    candidateList: document.getElementById('candidate-list'),
    candidateCount: document.getElementById('candidate-count'),
    previewSection: document.getElementById('preview-section'),
    previewVideo: document.getElementById('preview-video'),
    previewTitle: document.getElementById('preview-title'),
    previewCloseBtn: document.getElementById('preview-close-btn'),
    downloadBtn: document.getElementById('download-btn'),
    cancelBtn: document.getElementById('cancel-btn'),
    progressSection: document.getElementById('progress-section'),
    progressBar: document.getElementById('progress-bar'),
    progressMessage: document.getElementById('progress-message'),
    logs: document.getElementById('logs'),
  };

  let currentPageUrl = '';
  let pageTitle = '';
  let currentEpisode = '';
  let candidates = [];
  let selectedIndex = -1;
  let isDownloading = false;
  let activeTaskId = '';
  let lastRenderedStateKey = '';
  let scanToken = 0;

  function isValidHttpUrl(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch (e) {
      return false;
    }
  }

  function sendMessageWithTimeout(msg, timeoutMs = 30000) {
    return Promise.race([
      chrome.runtime.sendMessage(msg),
      new Promise((_, reject) => setTimeout(() => reject(new Error('请求超时')), timeoutMs))
    ]);
  }

  function detectDirectPlatform(url) {
    try {
      let host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
      const map = { 'youtube.com':'YouTube','youtu.be':'YouTube','twitter.com':'Twitter/X','x.com':'Twitter/X','bilibili.com':'Bilibili','b23.tv':'Bilibili' };
      for (const [d, l] of Object.entries(map)) if (host === d || host.endsWith('.'+d)) return l;
    } catch(e) {}
    if (/\.(m3u8|mpd)(\?|$)/i.test(url)) return 'HLS/DASH 直链';
    return null;
  }

  function isLikelyPlaylistUrl(url) {
    return /\.(m3u8|mpd)(\?|$)/i.test(url);
  }

  function isMeaninglessTitle(title) {
    const normalized = (title || '').trim().toLowerCase();
    if (!normalized) return true;
    const boringTitles = new Set([
      'new message!',
      'new message',
      'message',
      'messages',
      'home',
      'index',
      'video',
      'play',
      '播放',
      '在线播放',
    ]);
    return boringTitles.has(normalized) || normalized.length <= 2;
  }

  function prettifySlug(value) {
    return (value || '')
      .replace(/\.(m3u8|mp4|mpd|m4s)$/i, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function deriveNameFromUrl(url) {
    try {
      const pathname = new URL(url).pathname;
      const parts = pathname.split('/').filter(Boolean).reverse();
      for (const rawPart of parts) {
        const part = prettifySlug(rawPart);
        if (!part) continue;
        // 跳过无意义的通用路径段
        if (/^(index|video|play|playlist|master|status|watch|embed|reel|shorts|live|post|p)$/i.test(part)) continue;
        // 跳过纯十六进制哈希（如 CDN 缓存 key），但保留纯数字 ID
        if (/^[0-9a-f]{8,}$/i.test(part) && /[a-f]/i.test(part)) continue;
        return part;
      }
    } catch (e) {}
    return '';
  }

  /** 从已知平台 URL 提取有意义的文件名（平台名 + 用户名/ID） */
  function derivePlatformName(url) {
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase().replace(/^www\./, '');
      const parts = u.pathname.split('/').filter(Boolean);

      // Twitter/X: /username/status/tweetId
      if (host === 'x.com' || host === 'twitter.com') {
        const username = parts[0] || '';
        const tweetId = parts[2] || '';
        if (username && tweetId) return `X ${username} ${tweetId}`;
        if (tweetId) return `X ${tweetId}`;
        if (username) return `X ${username}`;
        return 'X video';
      }

      // YouTube: /watch?v=videoId  or /shorts/videoId
      if (host === 'youtube.com' || host === 'youtu.be') {
        const videoId = u.searchParams.get('v') || parts[parts.length - 1] || '';
        if (videoId) return `YouTube ${videoId}`;
        return 'YouTube video';
      }

      // Bilibili: /video/BVxxxxxx
      if (host === 'bilibili.com' || host === 'b23.tv') {
        const bvid = parts.find(p => /^[Bb][Vv]/.test(p)) || parts[parts.length - 1] || '';
        if (bvid) return `Bilibili ${bvid}`;
        return 'Bilibili video';
      }
    } catch (e) {}
    return '';
  }

  function extractNameFromPlaylistText(text) {
    const lines = (text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    for (const line of lines) {
      if (line.startsWith('#EXTINF:') && line.includes(',')) {
        const title = prettifySlug(line.split(',', 2)[1]);
        if (title && !isMeaninglessTitle(title)) return title;
      }
      if (line.startsWith('#EXT-X-MEDIA:') && /NAME="/i.test(line)) {
        const match = line.match(/NAME="([^"]+)"/i);
        const title = prettifySlug(match?.[1] || '');
        if (title && !isMeaninglessTitle(title)) return title;
      }
    }
    return '';
  }

  async function fetchTextSafely(url) {
    const response = await fetch(url, { method: 'GET', cache: 'no-store' });
    const text = await response.text();
    return { response, text };
  }

  async function validateCandidateUrl(candidate) {
    try {
      if (isLikelyPlaylistUrl(candidate.url)) {
        const { response, text } = await fetchTextSafely(candidate.url);
        const isPlaylist = response.ok && /#EXTM3U|#EXTINF|#EXT-X-STREAM-INF/.test(text);
        return {
          ...candidate,
          validationStatus: isPlaylist ? 'ok' : 'bad',
          validationMessage: isPlaylist ? 'M3U8 有效' : `返回内容不是 M3U8 (${response.status})`,
          inferredTitle: extractNameFromPlaylistText(text) || deriveNameFromUrl(candidate.url),
        };
      }

      const response = await fetch(candidate.url, { method: 'HEAD', cache: 'no-store' });
      return {
        ...candidate,
        validationStatus: response.ok ? 'ok' : 'bad',
        validationMessage: response.ok ? '地址可访问' : `HTTP ${response.status}`,
        inferredTitle: deriveNameFromUrl(candidate.url),
      };
    } catch (error) {
      return {
        ...candidate,
        validationStatus: 'bad',
        validationMessage: error.message || '校验失败',
        inferredTitle: deriveNameFromUrl(candidate.url),
      };
    }
  }

  async function enrichCandidates(rawCandidates, token) {
    const enriched = await Promise.all(rawCandidates.map(candidate => validateCandidateUrl(candidate)));
    if (token !== scanToken) return [];
    return enriched.sort((a, b) => {
      const aScore = a.validationStatus === 'ok' ? 1 : 0;
      const bScore = b.validationStatus === 'ok' ? 1 : 0;
      if (bScore !== aScore) return bScore - aScore;
      return (b.lastSeenAt || 0) - (a.lastSeenAt || 0);
    });
  }

  function buildCandidates(mediaItems, videoMetas) {
    const seen = new Set();
    const list = [];
    for (const item of mediaItems) {
      const url = item.url;
      if (seen.has(url)) continue;
      if (!isValidHttpUrl(url)) {
        log(`过滤无效地址: ${url.substring(0,80)}`, 'warn');
        continue;
      }
      seen.add(url);
      let meta = videoMetas.find(m => m.src && (url.includes(m.src) || m.src.includes(url)));
      if (!meta) meta = {};
      list.push({
        url,
        width: meta.width || 0,
        height: meta.height || 0,
        duration: meta.duration || 0,
        episodeText: item.episodeText || '',
        lastSeenAt: item.lastSeenAt || 0,
        inferredTitle: '',
        validationStatus: 'pending',
        validationMessage: '待校验',
      });
    }
    return list;
  }

  function formatMeta(c) {
    const parts = [];
    if (c.width && c.height) parts.push(`${c.width}x${c.height}`);
    if (c.duration) parts.push(`${Math.floor(c.duration/60)}:${String(c.duration%60).padStart(2,'0')}`);
    return parts.join(' | ');
  }

  function previewTitle(candidate = null) {
    const parts = [];
    const title = isMeaninglessTitle(pageTitle) ? (candidate?.inferredTitle || '') : pageTitle;
    if (title) parts.push(title);
    if (candidate?.episodeText) parts.push(candidate.episodeText);
    return parts.join(' - ') || '预览';
  }

  function sanitizeFileNamePart(value) {
    return (value || '')
      // 移除 URL（http/https 链接）
      .replace(/https?:\/\/\S+/gi, '')
      // 移除 emoji 及其他非常规 Unicode 符号
      .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu, '')
      // 将中文全角引号、特殊引号替换为空格
      .replace(/[\u201C\u201D\u2018\u2019\u300C\u300D\u300E\u300F\uFF02\uFF07"]/g, ' ')
      // 移除文件系统非法字符
      .replace(/[<>:\/\\|?*\u0000-\u001f]/g, ' ')
      // 移除 # @ 等社交媒体符号
      .replace(/[#@]/g, '')
      // 合并连续空白为单个空格
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** 按字节截断字符串，确保不截断多字节字符 */
  function truncateToByteLength(str, maxBytes) {
    const encoder = new TextEncoder();
    const encoded = encoder.encode(str);
    if (encoded.length <= maxBytes) return str;
    // 从后向前逐字符缩减
    let truncated = str;
    while (new TextEncoder().encode(truncated).length > maxBytes) {
      truncated = truncated.slice(0, -1);
    }
    return truncated.trim();
  }

  function buildOutputName(candidate) {
    const MAX_FILENAME_CHARS = 120;  // 字符级上限，避免文件名过长
    const MAX_FILENAME_BYTES = 200;  // 字节级上限，macOS HFS+/APFS 限制 255 字节（留余量给扩展名）

    const parts = [];
    let titleSource;
    if (!isMeaninglessTitle(pageTitle)) {
      titleSource = pageTitle;
    } else {
      // 回退优先级：候选推断标题 → 平台智能命名 → URL 路径推断
      titleSource = candidate?.inferredTitle
        || derivePlatformName(candidate?.url || currentPageUrl)
        || deriveNameFromUrl(candidate?.url || '');
    }
    let title = sanitizeFileNamePart(titleSource);
    const episode = sanitizeFileNamePart(candidate?.episodeText || '');

    // 字符级截断
    if (title.length > MAX_FILENAME_CHARS) {
      title = title.substring(0, MAX_FILENAME_CHARS).trim();
      // 尝试在最后一个空格处截断，避免截断单词
      const lastSpace = title.lastIndexOf(' ', MAX_FILENAME_CHARS);
      if (lastSpace > MAX_FILENAME_CHARS * 0.5) {
        title = title.substring(0, lastSpace).trim();
      }
    }

    if (title) parts.push(title);
    if (episode && episode !== title) parts.push(episode);
    let result = parts.join(' - ') || 'video';

    // 字节级截断（处理中文等多字节字符）
    result = truncateToByteLength(result, MAX_FILENAME_BYTES);

    // 移除末尾的句点和空格（文件系统不喜欢）
    result = result.replace(/[.\s]+$/, '') || 'video';

    return result;
  }

  function formatSeenTime(timestamp) {
    if (!timestamp) return '未知时间';
    return new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false });
  }

  function buildCandidateBadgeText(candidate) {
    const parts = [];
    if (candidate.validationStatus === 'ok') parts.push('可用');
    if (candidate.validationStatus === 'bad') parts.push(candidate.validationMessage || '无效');
    const meta = formatMeta(candidate);
    if (meta) parts.push(meta);
    return parts.join(' | ') || '待校验';
  }

  function setDownloadUiBusy(busy) {
    isDownloading = busy;
    els.downloadBtn.disabled = busy;
    els.directDownloadBtn.disabled = busy;
    if (busy) {
      els.cancelBtn.classList.remove('hidden');
      els.progressSection.classList.remove('hidden');
    } else {
      els.cancelBtn.classList.add('hidden');
    }
  }

  function applyDownloadState(state) {
    if (!state) {
      setDownloadUiBusy(false);
      activeTaskId = '';
      els.progressSection.classList.add('hidden');
      els.progressBar.style.width = '0%';
      els.progressMessage.textContent = '';
      lastRenderedStateKey = '';
      return;
    }

    activeTaskId = state.taskId || '';
    const stateKey = JSON.stringify({
      taskId: state.taskId || '',
      status: state.status || '',
      message: state.message || '',
      error: state.error || '',
      finalPath: state.artifacts?.final_path || '',
    });
    if (state.status === 'running') {
      setDownloadUiBusy(true);
      setStatus('下载中...', 'busy');
      updateProgress(state.stage, state.current, state.total, state.message);
      lastRenderedStateKey = stateKey;
      return;
    }

    setDownloadUiBusy(false);
    if (state.status === 'completed') {
      els.progressSection.classList.remove('hidden');
      updateProgress(state.stage || 'download', state.total || 100, state.total || 100, state.message || '下载完成');
      setStatus('下载完成', 'success');
      if (state.artifacts?.final_path && stateKey !== lastRenderedStateKey) log('下载完成: ' + state.artifacts.final_path, 'success');
      lastRenderedStateKey = stateKey;
      return;
    }

    if (state.status === 'failed') {
      setStatus('下载失败', 'error');
      if (state.error && stateKey !== lastRenderedStateKey) log('下载失败: ' + state.error, 'error');
      lastRenderedStateKey = stateKey;
      return;
    }

    if (state.status === 'cancelled') {
      setStatus('已取消', 'idle');
      if (stateKey !== lastRenderedStateKey) log('已取消当前下载', 'warn');
      lastRenderedStateKey = stateKey;
    }
  }

  function openPreview(candidate) {
    els.previewTitle.textContent = previewTitle(candidate);
    els.previewSection.classList.remove('hidden');
    els.previewVideo.src = candidate.url;
    els.previewVideo.load();
    els.previewVideo.play()?.catch(() => {});
  }

  function closePreview() {
    els.previewVideo.pause();
    els.previewVideo.src = '';
    els.previewSection.classList.add('hidden');
  }

  function startDownloadWithCandidate(candidate) {
    if (!isValidHttpUrl(candidate.url)) {
      log(`下载地址无效: ${candidate.url.substring(0,100)}`, 'error');
      setStatus('地址无效', 'error');
      return;
    }
    if (candidate.validationStatus === 'bad') {
      log(`候选地址不可用，已阻止下载: ${candidate.validationMessage}`, 'error');
      setStatus('候选失效', 'error');
      return;
    }
    const outputName = buildOutputName(candidate);
    setDownloadUiBusy(true);
    setStatus('下载中...', 'busy');

    log(`发送下载请求: ${candidate.url}`);

    sendMessageWithTimeout({
      type: 'download',
      request: {
        page_url: currentPageUrl,
        resource_url: candidate.url,
        output_dir: '',
        output_name: outputName,
        page_title: pageTitle,
        current_episode: currentEpisode,
        headers: {},
        candidate: { url: candidate.url, kind: candidate.kind || 'media', score: 0, source: '', note: '', has_drm: false, drm_types: [] },
      },
    }, 15000).then(res => {
      if (res.success) {
        activeTaskId = res.taskId || '';
        log(`下载任务已启动，文件名: ${outputName}`);
      } else {
        setDownloadUiBusy(false);
        setStatus('下载失败', 'error');
        log('下载失败: ' + res.error, 'error');
      }
    }).catch(err => {
      setDownloadUiBusy(false);
      setStatus('下载失败', 'error');
      log('下载错误: ' + err.message, 'error');
    });
  }

  const port = chrome.runtime.connect({ name: 'popup' });
  port.onMessage.addListener((msg) => {
    if (msg.type === 'progress') updateProgress(msg.stage, msg.current, msg.total, msg.message);
    else if (msg.type === 'download_state') applyDownloadState(msg.state);
    else if (msg.type === 'native_error') { setStatus('服务未连接', 'error'); log('本地下载服务未连接', 'error'); }
  });

  function log(msg, type = '') {
    const line = document.createElement('div');
    line.className = 'log-line' + (type ? ` log-${type}` : '');
    line.textContent = `[${new Date().toLocaleTimeString('zh-CN',{hour12:false})}] ${msg}`;
    els.logs.appendChild(line);
    els.logs.scrollTop = els.logs.scrollHeight;
  }

  function setStatus(text, tone = 'idle') {
    els.status.textContent = text;
    const map = { idle:'rgba(222,186,120,0.14)', busy:'rgba(218,150,50,0.18)', error:'rgba(166,71,40,0.18)', success:'rgba(81,141,103,0.18)' };
    const c = { idle:'#8a6a3f', busy:'#8a5a1f', error:'#a33d2a', success:'#3a7a4a' };
    els.status.style.background = map[tone] || map.idle;
    els.status.style.color = c[tone] || c.idle;
  }

  function updateProgress(stage, current, total, message) {
    const pct = total > 0 ? Math.round((current/total)*100) : 0;
    els.progressBar.style.width = pct + '%';
    els.progressMessage.textContent = message || `${stage}: ${current}/${total}`;
  }

  function renderCandidates() {
    els.candidateList.innerHTML = '';
    candidates.forEach((c, i) => {
      const item = document.createElement('div');
      item.className = 'candidate-item';
      if (i === selectedIndex) item.classList.add('selected');
      if (c.validationStatus === 'bad') item.classList.add('is-invalid');

      const row = document.createElement('div');
      row.className = 'candidate-row';

      const infoDiv = document.createElement('div');
      infoDiv.style.flex = '1';
      infoDiv.style.minWidth = '0';

      const titleDiv = document.createElement('div');
      titleDiv.className = 'candidate-title';
      titleDiv.textContent = c.episodeText || c.inferredTitle || '未命名候选';
      infoDiv.appendChild(titleDiv);

      const urlDiv = document.createElement('div');
      urlDiv.className = 'candidate-url';
      urlDiv.textContent = c.url;
      urlDiv.title = c.url;
      infoDiv.appendChild(urlDiv);
      row.appendChild(infoDiv);

      const metaDiv = document.createElement('div');
      metaDiv.className = 'candidate-meta';
      metaDiv.textContent = buildCandidateBadgeText(c);
      row.appendChild(metaDiv);

      item.appendChild(row);
      const subRow = document.createElement('div');
      subRow.className = 'candidate-subrow';
      const timeDiv = document.createElement('div');
      timeDiv.className = 'candidate-time';
      timeDiv.textContent = `出现时间 ${formatSeenTime(c.lastSeenAt)}`;
      subRow.appendChild(timeDiv);
      item.appendChild(subRow);
      item.addEventListener('click', () => {
        selectedIndex = i;
        document.querySelectorAll('.candidate-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
        openPreview(c);
      });
      els.candidateList.appendChild(item);
    });
    els.candidateCount.textContent = `(${candidates.length})`;
  }

  // 初始化
  chrome.runtime.sendMessage({ type: 'get_detected_urls' }).then(res => {
    currentPageUrl = isValidHttpUrl(res.pageUrl) ? res.pageUrl : '';
    pageTitle = res.pageTitle || '';
    currentEpisode = res.currentEpisode || '';
    if (res.urls?.length > 0) {
      els.detectedHint.textContent = `页面已发现 ${res.urls.length} 个媒体地址，点击下方按钮刷新列表。`;
    }
    const platform = detectDirectPlatform(currentPageUrl);
    if (platform) {
      els.probeBtn.classList.add('hidden');
      els.directDownloadBtn.classList.remove('hidden');
      els.detectedHint.textContent = `检测到 ${platform}，可直接下载。`;
      setStatus(`${platform} 直下`, 'success');
    }
  }).catch(e => log('获取页面信息失败: ' + e.message, 'error'));

  chrome.runtime.sendMessage({ type: 'get_download_state' }).then(res => {
    if (res?.success && res.state) {
      if (res.state.status === 'running') {
        // 有正在进行的下载，恢复状态
        applyDownloadState(res.state);
      } else {
        // 已完成/失败/取消的历史任务，清理掉，从干净状态开始
        chrome.runtime.sendMessage({ type: 'clear_download_state' });
        applyDownloadState(null);
      }
    }
  }).catch(() => {});

  // 探测
  els.probeBtn.addEventListener('click', () => {
    scanToken += 1;
    const token = scanToken;
    if (!currentPageUrl) { log('无法获取当前页面地址', 'error'); return; }
    setStatus('探测中...', 'busy');
    els.probeBtn.disabled = true;
    els.detectedHint.textContent = '正在扫描页面媒体资源...';
    log(`开始扫描: ${currentPageUrl}`);

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (!tabId) { els.probeBtn.disabled = false; setStatus('获取标签页失败', 'error'); return; }

      chrome.tabs.sendMessage(tabId, { type: 'rescan' }, (res) => {
        if (chrome.runtime.lastError) log('内容脚本未响应，尝试刷新页面后重试', 'warn');

        chrome.runtime.sendMessage({ type: 'get_detected_urls' }).then(async detected => {
          const mediaMap = new Map();
          const detectedItems = detected.mediaItems || [];
          const resItems = (res?.urls || []).map(url => ({ url, lastSeenAt: Date.now(), episodeText: '' }));
          for (const item of detectedItems.concat(resItems)) {
            if (!item?.url) continue;
            const prev = mediaMap.get(item.url);
            if (!prev || (item.lastSeenAt || 0) >= (prev.lastSeenAt || 0)) {
              mediaMap.set(item.url, item);
            }
          }

          currentPageUrl = isValidHttpUrl(detected.pageUrl) ? detected.pageUrl : currentPageUrl;
          pageTitle = res?.pageTitle || detected.pageTitle || pageTitle;
          currentEpisode = res?.currentEpisode || detected.currentEpisode || currentEpisode;

          const metas = res?.videoMetas || detected.videoMetas || [];
          const rawCandidates = buildCandidates(
            Array.from(mediaMap.values()).sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0)),
            metas,
          );
          candidates = await enrichCandidates(rawCandidates, token);
          if (token !== scanToken) return;

          if (candidates.length > 0) {
            els.candidatesSection.classList.remove('hidden');
            selectedIndex = 0;
            renderCandidates();
            setStatus(`${candidates.length} 个候选`, 'success');
            const okCount = candidates.filter(item => item.validationStatus === 'ok').length;
            log(`扫描完成，找到 ${candidates.length} 个媒体地址，可用 ${okCount} 个`);
            openPreview(candidates[0]);
          } else {
            setStatus('未找到候选', 'error');
            log('未找到任何视频地址。请尝试刷新页面后再次扫描。', 'error');
          }
          els.probeBtn.disabled = false;
        }).catch(err => {
          els.probeBtn.disabled = false;
          setStatus('扫描失败', 'error');
          log('扫描错误: ' + err.message, 'error');
        });
      });
    });
  });

  els.downloadBtn.addEventListener('click', () => {
    if (selectedIndex < 0 || selectedIndex >= candidates.length) { log('请先点击列表选择一个地址', 'error'); return; }
    startDownloadWithCandidate(candidates[selectedIndex]);
  });

  els.directDownloadBtn.addEventListener('click', () => {
    if (!isValidHttpUrl(currentPageUrl)) {
      log(`页面地址无效，无法直接下载: ${currentPageUrl.substring(0,100)}`, 'error');
      setStatus('地址无效', 'error');
      return;
    }
    const platform = detectDirectPlatform(currentPageUrl);
    const label = platform || 'direct_download';
    startDownloadWithCandidate({ url: currentPageUrl, kind: 'direct_download', width:0, height:0, duration:0 });
  });

  els.previewCloseBtn.addEventListener('click', closePreview);

  els.cancelBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'cancel' });
    setStatus('已取消', 'idle');
    setDownloadUiBusy(false);
    log('已请求取消当前下载');
  });
});
