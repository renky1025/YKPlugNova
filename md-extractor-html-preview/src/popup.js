import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import juice from 'juice';
import { toPng } from 'html-to-image';
import { getPreviewHTML } from './preview-template.js';

// Elements
const extractBtn = document.getElementById('extract-btn');
const copyBtn = document.getElementById('copy-btn');
const downloadBtn = document.getElementById('download-btn');
const tabBtns = document.querySelectorAll('.tab-btn');
const panes = document.querySelectorAll('.pane');
const markdownInput = document.getElementById('markdown-input');
const markdownPreview = document.getElementById('markdown-preview');
const themeSelect = document.getElementById('theme-select');
const toast = document.getElementById('toast');

// Initialize Marked with highlight.js
marked.setOptions({
  highlight: function(code, lang) {
    const language = hljs.getLanguage(lang) ? lang : 'plaintext';
    return hljs.highlight(code, { language }).value;
  },
  langPrefix: 'hljs language-',
  breaks: true,
  gfm: true
});

// Update Preview
function updatePreview() {
  const mdText = markdownInput.value;
  const theme = themeSelect.value;
  if (!mdText) {
    markdownPreview.srcdoc = getPreviewHTML('<p style="color: #6b7280; text-align: center; margin-top: 40px;">No content to preview.</p>', theme);
    return;
  }
  const rawHtml = marked.parse(mdText);
  const safeHtml = DOMPurify.sanitize(rawHtml);
  markdownPreview.srcdoc = getPreviewHTML(safeHtml, theme);
}

// Event Listeners for Tabs
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    // Remove active from all
    tabBtns.forEach(b => b.classList.remove('active'));
    panes.forEach(p => p.classList.remove('active'));
    
    // Add active to clicked
    btn.classList.add('active');
    const targetId = btn.getAttribute('data-target');
    document.getElementById(targetId).classList.add('active');
    
    // If switching to preview, render markdown
    if (targetId === 'preview-pane') {
      updatePreview();
    }
  });
});

// Event Listener for Input
markdownInput.addEventListener('input', () => {
  if (document.getElementById('preview-pane').classList.contains('active')) {
    updatePreview();
  }
});

// Show Toast
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2000);
}

// Copy Action
copyBtn.addEventListener('click', async () => {
  const activePane = document.querySelector('.pane.active').id;
  
  try {
    if (activePane === 'editor-pane') {
      const text = markdownInput.value;
      if (!text) return showToast("Nothing to copy");
      await navigator.clipboard.writeText(text);
      showToast("Markdown Copied!");
    } else {
      // Copy rich text using juice to inline styles
      const iframeDoc = markdownPreview.contentDocument;
      if (!iframeDoc || !iframeDoc.body.innerHTML.trim() || iframeDoc.body.innerHTML.includes('No content to preview')) {
        return showToast("Nothing to copy");
      }
      
      // Inline the styles
      const inlinedHtml = juice(iframeDoc.documentElement.outerHTML);
      
      // We only want the body content for pasting, wrapped in a div
      const bodyContentMatch = inlinedHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      const htmlToCopy = bodyContentMatch ? bodyContentMatch[1] : inlinedHtml;
      
      const blobHtml = new Blob([htmlToCopy], { type: 'text/html' });
      // Text fallback
      const blobText = new Blob([iframeDoc.body.innerText], { type: 'text/plain' });
      
      const data = new ClipboardItem({
        'text/html': blobHtml,
        'text/plain': blobText
      });
      
      await navigator.clipboard.write([data]);
      showToast("Rich Text Copied!");
    }
  } catch (err) {
    console.error("Copy failed:", err);
    showToast("Copy Failed");
  }
});

// Download Image Action
downloadBtn.addEventListener('click', async () => {
  try {
    const iframeDoc = markdownPreview.contentDocument;
    if (!iframeDoc) return showToast("Preview not ready");
    
    showToast("Generating image...");
    
    // We target the markdown-body inside the iframe
    const targetNode = iframeDoc.querySelector('.markdown-body') || iframeDoc.body;
    
    const dataUrl = await toPng(targetNode, {
      backgroundColor: themeSelect.value === 'poster-neon' ? 'transparent' : (window.getComputedStyle(targetNode).backgroundColor || '#ffffff'),
      pixelRatio: 2,
      style: {
        margin: '0', // Reset margin for capture
      }
    });
    
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `md-extractor-${themeSelect.value}-${Date.now()}.png`;
    a.click();
    showToast("Image Downloaded!");
  } catch (err) {
    console.error("Download failed:", err);
    showToast("Download Failed");
  }
});

// Extract Content
extractBtn.addEventListener('click', async () => {
  extractBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"></path></svg> Extracting...';
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    } catch (e) {}

    chrome.tabs.sendMessage(tab.id, { action: 'extract' }, (response) => {
      extractBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="8 17 12 21 16 17"></polyline><line x1="12" y1="12" x2="12" y2="21"></line><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"></path></svg> Extract';
      
      if (chrome.runtime.lastError) {
        showToast("Error connecting to page");
        return;
      }
      
      if (response && response.success) {
        markdownInput.value = response.markdown;
        updatePreview();
        document.querySelector('[data-target="preview-pane"]').click();
        showToast("Extracted Successfully!");
      } else {
        showToast(response?.error || "Extraction failed");
      }
    });
  } catch (err) {
    console.error(err);
    extractBtn.innerHTML = 'Extract';
    showToast("Error extracting");
  }
});

// Theme Switching
themeSelect.addEventListener('change', () => {
  updatePreview();
});

// Init
// If needed, set a specific default value, though HTML sets it to "default" naturally if first option
updatePreview();
