(function() {
  'use strict';

  let lastClickedEpisodeText = '';
  let lastClickedEpisodeAt = 0;

  function looksLikeMedia(url) {
    return /\.(m3u8|mp4|mpd|m4s)(\?|$)/i.test(url);
  }

  function isValidHttpUrl(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch (e) {
      return false;
    }
  }

  function getPageTitle() {
    const og = document.querySelector('meta[property="og:title"]');
    if (og && og.content) return og.content.trim();
    const t = document.title.trim();
    return t || location.hostname;
  }

  // 从页面 DOM 中尝试找当前播放的是第几集
  function getCurrentEpisode() {
    if (lastClickedEpisodeText) return lastClickedEpisodeText;
    const selectors = [
      '.episode-item.active', '.episode-item.current', '.episode-item.on',
      '.playlist-item.active', '.playlist-item.current',
      '.item.active[data-episode]', '.item.current[data-episode]',
      '.active[data-episode-id]', '.current[data-episode-id]',
      '.num.active', '.num.current',
      '.list-item.active', '[class*="episode"][class*="active"]',
      '[class*="episode"][class*="current"]',
      '[aria-current="true"]', '[aria-selected="true"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent.trim();
        if (text) return text;
        const ep = el.getAttribute('data-episode') || el.getAttribute('data-episode-id');
        if (ep) return `第${ep}集`;
      }
    }
    try {
      const u = new URL(location.href);
      for (const key of ['ep', 'episode', 'num', 'index']) {
        const v = u.searchParams.get(key);
        if (v && /^\d+$/.test(v)) return `第${v}集`;
      }
    } catch (e) {}
    return '';
  }

  function normalizeEpisodeText(text) {
    return (text || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  function elementLooksLikeEpisodeButton(el) {
    if (!(el instanceof Element)) return false;
    const text = normalizeEpisodeText(el.textContent);
    if (!text || text.length > 40) return false;
    const attrs = [
      el.className,
      el.id,
      el.getAttribute('data-episode'),
      el.getAttribute('data-episode-id'),
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
    ].join(' ').toLowerCase();
    if (/[集话期章]/.test(text)) return true;
    if (/episode|ep-|playlist|playitem|current|active|selected|tab|btn|num|juji|ju-.*/.test(attrs)) return true;
    return false;
  }

  function rememberClickedEpisode(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    for (const node of path) {
      if (!(node instanceof Element)) continue;
      const candidate = node.closest('button, a, li, span, div');
      if (!candidate || !elementLooksLikeEpisodeButton(candidate)) continue;
      const text = normalizeEpisodeText(candidate.textContent)
        || normalizeEpisodeText(candidate.getAttribute('data-episode'))
        || normalizeEpisodeText(candidate.getAttribute('aria-label'))
        || normalizeEpisodeText(candidate.getAttribute('title'));
      if (text) {
        lastClickedEpisodeText = text;
        lastClickedEpisodeAt = Date.now();
        send();
        return;
      }
    }
  }

  function getVideoMeta() {
    const metas = [];
    document.querySelectorAll('video').forEach(video => {
      const rect = video.getBoundingClientRect();
      const isVisible = rect.width > 100 && rect.height > 50;
      if (!isVisible && document.querySelectorAll('video').length > 1) return;
      const src = video.currentSrc || video.src;
      if (src && !looksLikeMedia(src)) return;
      metas.push({
        src: src || '',
        width: video.videoWidth || 0,
        height: video.videoHeight || 0,
        duration: isFinite(video.duration) ? Math.round(video.duration) : 0,
      });
    });
    return metas;
  }

  function extractVideoUrls() {
    const urls = new Set();

    document.querySelectorAll('video, audio').forEach(el => {
      const src = el.currentSrc || el.src;
      if (src && looksLikeMedia(src) && isValidHttpUrl(src)) urls.add(src);
      el.querySelectorAll('source').forEach(s => {
        if (s.src && looksLikeMedia(s.src) && isValidHttpUrl(s.src)) urls.add(s.src);
      });
    });

    const globals = ['s_video_plays','video_plays','player','videoPlayer','hlsUrl','m3u8Url','videoSrc','playList','videoList'];
    globals.forEach(name => {
      try {
        const val = window[name];
        if (!val) return;
        if (typeof val === 'string' && val.match(/^https?:\/\//) && looksLikeMedia(val) && isValidHttpUrl(val)) {
          urls.add(val);
        } else if (Array.isArray(val)) {
          val.forEach(item => {
            if (!item || typeof item !== 'object') return;
            ['play_data','url','src','file'].forEach(k => {
              if (item[k] && looksLikeMedia(item[k]) && isValidHttpUrl(item[k])) urls.add(item[k]);
            });
          });
        } else if (typeof val === 'object') {
          ['play_data','url','src','file'].forEach(k => {
            if (val[k] && looksLikeMedia(val[k]) && isValidHttpUrl(val[k])) urls.add(val[k]);
          });
        }
      } catch(e) {}
    });

    try {
      performance.getEntriesByType('resource').forEach(r => {
        if (r.name && looksLikeMedia(r.name) && isValidHttpUrl(r.name)) urls.add(r.name);
      });
    } catch(e) {}

    try {
      document.querySelectorAll('script:not([src])').forEach(script => {
        const text = script.textContent || '';
        const matches = text.match(/https?:\/\/[^\s"'<>]+\.(m3u8|mp4|mpd)/gi);
        if (matches) matches.forEach(u => { if (isValidHttpUrl(u)) urls.add(u); });
      });
    } catch(e) {}

    return Array.from(urls);
  }

  function collect() {
    return {
      pageUrl: location.href,
      pageTitle: getPageTitle(),
      currentEpisode: getCurrentEpisode(),
      currentEpisodeUpdatedAt: lastClickedEpisodeAt,
      collectedAt: Date.now(),
      videoMetas: getVideoMeta(),
      urls: extractVideoUrls(),
    };
  }

  function send() {
    const data = collect();
    if (data.urls.length > 0) {
      chrome.runtime.sendMessage({ type: 'page_media', ...data }).catch(() => {});
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'rescan') {
      const data = collect();
      sendResponse(data);
      if (data.urls.length > 0) {
        chrome.runtime.sendMessage({ type: 'page_media', ...data }).catch(() => {});
      }
    }
    return true;
  });

  send();
  setTimeout(send, 1500);
  setTimeout(send, 4000);
  document.addEventListener('click', rememberClickedEpisode, true);

  if (document.body) {
    const observer = new MutationObserver(() => send());
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();
