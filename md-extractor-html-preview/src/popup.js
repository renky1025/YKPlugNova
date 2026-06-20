// ─── Startup-critical imports only (tiny, no parsing cost) ───────────────────
// getPreviewHTML is a pure template string function — no heavy deps
import { getPreviewHTML } from './preview-template.js';

// marked, DOMPurify, hljs are ALL lazy-loaded: they are only needed when the
// preview pane is first rendered. This keeps the popup startup cost near zero.

// ─── DOM elements ────────────────────────────────────────────────────────────
const extractBtn    = document.getElementById('extract-btn');
const copyBtn       = document.getElementById('copy-btn');
const downloadBtn   = document.getElementById('download-btn');
const downloadMdBtn = document.getElementById('download-md-btn');
const tabBtns       = document.querySelectorAll('.tab-btn');
const panes         = document.querySelectorAll('.pane');
const markdownInput = document.getElementById('markdown-input');
const markdownPreview = document.getElementById('markdown-preview');
const themeSelect   = document.getElementById('theme-select');
const toast         = document.getElementById('toast');

// ─── State ───────────────────────────────────────────────────────────────────
let pageTitle = '';
let pageUrl   = '';

// ─── Lazy preview library ─────────────────────────────────────────────────────
// The first call loads marked + DOMPurify + hljs (core + 10 key languages).
// Subsequent calls return the cached promise — no double-loading.
let _previewLibPromise = null;

function loadPreviewLib() {
  if (_previewLibPromise) return _previewLibPromise;

  _previewLibPromise = (async () => {
    // Load in parallel for minimum wall-clock time
    const [
      { marked },
      { default: DOMPurify },
      { default: hljs },
      // 10 highest-value languages — covers >95% of code blocks on the web
      { default: langJS },
      { default: langTS },
      { default: langPy },
      { default: langBash },
      { default: langJSON },
      { default: langCSS },
      { default: langSQL },
      { default: langJava },
      { default: langCpp },
      { default: langRust },
    ] = await Promise.all([
      import('marked'),
      import('dompurify'),
      import('highlight.js/lib/core'),
      import('highlight.js/lib/languages/javascript'),
      import('highlight.js/lib/languages/typescript'),
      import('highlight.js/lib/languages/python'),
      import('highlight.js/lib/languages/bash'),
      import('highlight.js/lib/languages/json'),
      import('highlight.js/lib/languages/css'),
      import('highlight.js/lib/languages/sql'),
      import('highlight.js/lib/languages/java'),
      import('highlight.js/lib/languages/cpp'),
      import('highlight.js/lib/languages/rust'),
    ]);

    hljs.registerLanguage('javascript', langJS);
    hljs.registerLanguage('js',         langJS);
    hljs.registerLanguage('typescript', langTS);
    hljs.registerLanguage('ts',         langTS);
    hljs.registerLanguage('python',     langPy);
    hljs.registerLanguage('py',         langPy);
    hljs.registerLanguage('bash',       langBash);
    hljs.registerLanguage('shell',      langBash);
    hljs.registerLanguage('sh',         langBash);
    hljs.registerLanguage('json',       langJSON);
    hljs.registerLanguage('css',        langCSS);
    hljs.registerLanguage('sql',        langSQL);
    hljs.registerLanguage('java',       langJava);
    hljs.registerLanguage('cpp',        langCpp);
    hljs.registerLanguage('c++',        langCpp);
    hljs.registerLanguage('rust',       langRust);

    marked.setOptions({
      highlight: (code, lang) => {
        const language = hljs.getLanguage(lang) ? lang : 'plaintext';
        return hljs.highlight(code, { language }).value;
      },
      langPrefix: 'hljs language-',
      breaks: true,
      gfm: true,
    });

    return { marked, DOMPurify };
  })();

  return _previewLibPromise;
}

// ─── Preview rendering ────────────────────────────────────────────────────────
// Called only when preview pane is active. Fires loadPreviewLib() on first use.
async function updatePreview() {
  const mdText = markdownInput.value;
  const theme  = themeSelect.value;

  if (!mdText) {
    markdownPreview.srcdoc = getPreviewHTML(
      '<p style="color:#6b7280;text-align:center;margin-top:40px">No content to preview.</p>',
      theme
    );
    return;
  }

  const { marked, DOMPurify } = await loadPreviewLib();
  const rawHtml  = marked.parse(mdText);
  const safeHtml = DOMPurify.sanitize(rawHtml);
  markdownPreview.srcdoc = getPreviewHTML(safeHtml, theme);
}

// ─── Toast ───────────────────────────────────────────────────────────────────
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

// ─── Tab switching ───────────────────────────────────────────────────────────
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(b => b.classList.remove('active'));
    panes.forEach(p => p.classList.remove('active'));

    btn.classList.add('active');
    const targetId = btn.getAttribute('data-target');
    document.getElementById(targetId).classList.add('active');

    if (targetId === 'preview-pane') updatePreview();
  });
});

// Live update when editing in markdown tab
markdownInput.addEventListener('input', () => {
  if (document.getElementById('preview-pane').classList.contains('active')) {
    updatePreview();
  }
});

// ─── Theme switching ──────────────────────────────────────────────────────────
themeSelect.addEventListener('change', () => updatePreview());

// ─── Copy ────────────────────────────────────────────────────────────────────
copyBtn.addEventListener('click', async () => {
  const activePane = document.querySelector('.pane.active').id;
  try {
    if (activePane === 'editor-pane') {
      const text = markdownInput.value;
      if (!text) return showToast('Nothing to copy');
      await navigator.clipboard.writeText(text);
      showToast('Markdown Copied!');
    } else {
      const iframeDoc = markdownPreview.contentDocument;
      if (
        !iframeDoc ||
        !iframeDoc.body.innerHTML.trim() ||
        iframeDoc.body.innerHTML.includes('No content to preview')
      ) return showToast('Nothing to copy');

      // juice is lazy-loaded — only needed for rich-text copy
      const { default: juice } = await import('juice');
      const inlinedHtml = juice(iframeDoc.documentElement.outerHTML);
      const bodyMatch   = inlinedHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      const htmlToCopy  = bodyMatch ? bodyMatch[1] : inlinedHtml;

      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html':  new Blob([htmlToCopy],              { type: 'text/html' }),
          'text/plain': new Blob([iframeDoc.body.innerText], { type: 'text/plain' }),
        }),
      ]);
      showToast('Rich Text Copied!');
    }
  } catch (err) {
    console.error('Copy failed:', err);
    showToast('Copy Failed');
  }
});

// ─── Download Markdown ───────────────────────────────────────────────────────
downloadMdBtn.addEventListener('click', () => {
  const text = markdownInput.value;
  if (!text) return showToast('Nothing to download');

  const safeTitle = pageTitle
    ? pageTitle.replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
    : null;
  const filename = safeTitle ? `${safeTitle}.md` : `extracted-${Date.now()}.md`;

  const sourceHeader = pageUrl ? `来源: ${pageUrl}\n\n` : '';
  const blob = new Blob([sourceHeader + text], { type: 'text/markdown;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Downloaded: ${filename}`);
});

// ─── Download PNG ────────────────────────────────────────────────────────────
downloadBtn.addEventListener('click', async () => {
  try {
    const iframeDoc = markdownPreview.contentDocument;
    if (!iframeDoc) return showToast('Preview not ready');

    showToast('Generating image...');

    // html-to-image is lazy-loaded — only needed for PNG export
    const { toPng } = await import('html-to-image');
    const targetNode = iframeDoc.querySelector('.markdown-body') || iframeDoc.body;

    const dataUrl = await toPng(targetNode, {
      backgroundColor:
        themeSelect.value === 'poster-neon'
          ? 'transparent'
          : window.getComputedStyle(targetNode).backgroundColor || '#ffffff',
      pixelRatio: 2,
      style: { margin: '0' },
    });

    const a    = document.createElement('a');
    a.href     = dataUrl;
    a.download = `md-extractor-${themeSelect.value}-${Date.now()}.png`;
    a.click();
    showToast('Image Downloaded!');
  } catch (err) {
    console.error('Download failed:', err);
    showToast('Download Failed');
  }
});

// ─── Extract ─────────────────────────────────────────────────────────────────
extractBtn.addEventListener('click', async () => {
  extractBtn.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"></path></svg> Extracting...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    } catch (_) {}

    chrome.tabs.sendMessage(tab.id, { action: 'extract' }, (response) => {
      extractBtn.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="8 17 12 21 16 17"></polyline><line x1="12" y1="12" x2="12" y2="21"></line><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"></path></svg> Extract';

      if (chrome.runtime.lastError) return showToast('Error connecting to page');

      if (response?.success) {
        pageTitle = response.title || '';
        pageUrl   = response.url   || '';
        markdownInput.value = response.markdown;

        // Kick off lazy lib loading in background while switching tabs
        // so it's ready (or nearly ready) when preview renders
        loadPreviewLib();

        document.querySelector('[data-target="preview-pane"]').click();
        showToast('Extracted Successfully!');
      } else {
        showToast(response?.error || 'Extraction failed');
      }
    });
  } catch (err) {
    console.error(err);
    extractBtn.innerHTML = 'Extract';
    showToast('Error extracting');
  }
});
