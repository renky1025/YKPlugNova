(function() {
  'use strict';

  // Avoid duplicate injection
  if (window.__twitterReplyAssistantInjected) return;
  window.__twitterReplyAssistantInjected = true;

  function normalizeWhitespace(text) {
    return (text || '')
      .replace(/\r/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  function dedupeLines(text) {
    const seen = new Set();
    const lines = normalizeWhitespace(text).split('\n');
    const result = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        if (result[result.length - 1] !== '') result.push('');
        continue;
      }

      const key = line.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(line);
    }

    return result.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function escapeMarkdown(text) {
    return (text || '').replace(/([\\`*_{}\[\]()#+\-.!|>])/g, '\\$1');
  }

  function sanitizeCodeFence(text) {
    return (text || '')
      .replace(/\r/g, '')
      .replace(/^\n+|\n+$/g, '')
      .replace(/```/g, '``\\`');
  }

  function collectListMarkdown(listEl, depth = 0) {
    const items = Array.from(listEl.children).filter(child => child.tagName === 'LI');
    const lines = [];

    for (const li of items) {
      const nestedLists = Array.from(li.children).filter(child => child.tagName === 'UL' || child.tagName === 'OL');
      const clone = li.cloneNode(true);
      clone.querySelectorAll('ul, ol').forEach(node => node.remove());
      const itemText = normalizeWhitespace(clone.innerText);
      if (itemText) {
        lines.push(`${'  '.repeat(depth)}- ${itemText}`);
      }
      nestedLists.forEach(nested => {
        lines.push(collectListMarkdown(nested, depth + 1));
      });
    }

    return lines.filter(Boolean).join('\n');
  }

  function formatBlockToMarkdown(block) {
    if (!block) return '';

    const codeEl = block.querySelector('pre, code');
    if (codeEl) {
      const codeText = sanitizeCodeFence(codeEl.innerText || block.innerText);
      return codeText ? `\`\`\`\n${codeText}\n\`\`\`` : '';
    }

    if (block.querySelector('blockquote, .longform-blockquote')) {
      const quoteText = normalizeWhitespace(block.innerText);
      return quoteText ? `> ${quoteText.split('\n').join('\n> ')}` : '';
    }

    const listEl = block.querySelector('ul, ol, .public-DraftStyleDefault-ul');
    if (listEl) {
      return collectListMarkdown(listEl);
    }

    const text = normalizeWhitespace(block.innerText);
    if (!text) return '';

    if (block.querySelector('h1, h2, h3, .longform-header-one, .longform-header-two, .longform-header-three')) {
      return `## ${text}`;
    }

    return text;
  }

  function stripMarkdownArtifacts(text) {
    return (text || '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/^>\s.*$/gm, '')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/\n{3,}/g, '\n\n');
  }

  function findMainArticle() {
    const allArticles = Array.from(document.querySelectorAll('article'));
    if (allArticles.length === 0) return null;

    // Strategy 1: On a /status/ID page, match the article whose status link ends with the CURRENT status ID.
    const statusMatch = window.location.pathname.match(/\/status\/(\d+)/);
    if (statusMatch) {
      const currentStatusId = statusMatch[1];
      for (const art of allArticles) {
        const links = art.querySelectorAll('a[href*="/status/"]');
        for (const link of links) {
          let href = link.getAttribute('href') || '';
          if (href.startsWith('http')) {
            try { href = new URL(href).pathname; } catch (e) {}
          }
          href = href.split('?')[0].split('#')[0];
          if (href.endsWith(`/status/${currentStatusId}`)) {
            return art;
          }
        }
      }
    }

    // Strategy 2: On timeline/profile pages, pick the first article that has a User-Name.
    for (const art of allArticles) {
      if (art.querySelector('[data-testid="User-Name"]')) {
        return art;
      }
    }

    // Strategy 3: Ultimate fallback
    return allArticles[0];
  }

  function extractLongformText(article) {
    const richTextView = article.querySelector('[data-testid="twitterArticleRichTextView"]');
    if (!richTextView) return null;

    let md = '';
    const blocks = richTextView.querySelectorAll('[data-block="true"]');

    for (const block of blocks) {
      // Skip media/image sections
      if (block.tagName === 'SECTION' && block.querySelector('img, [data-testid="tweetPhoto"], a[href*="/media/"]')) {
        continue;
      }
      // Skip separators
      if (block.querySelector('[role="separator"]')) {
        md += '\n---\n\n';
        continue;
      }

      const blockMarkdown = formatBlockToMarkdown(block);
      if (blockMarkdown) md += `${blockMarkdown}\n\n`;
    }

    return normalizeWhitespace(md) || null;
  }

  function extractTextFromArticle(article) {
    // 0. Long-form article (Twitter/X Articles) — PRIORITY
    const longform = extractLongformText(article);
    if (longform) return longform;

    // 1. Standard tweet
    let el = article.querySelector('[data-testid="tweetText"]');
    if (el) {
      const t = dedupeLines(el.innerText);
      if (t) return t;
    }

    // 2. Div with lang attribute
    const langDivs = article.querySelectorAll('div[lang]');
    for (const div of langDivs) {
      if (div.closest('article') !== article) continue;
      if (div.closest('[data-testid="User-Name"]')) continue;
      if (div.closest('[role="group"]')) continue;
      if (div.closest('[role="button"]')) continue;
      const t = dedupeLines(div.innerText);
      if (t.length > 0) return t;
    }

    // 3. div[dir="auto"] or div[dir="ltr"] with substantial text
    const dirDivs = article.querySelectorAll('div[dir="auto"], div[dir="ltr"]');
    for (const div of dirDivs) {
      if (div.closest('article') !== article) continue;
      if (div.closest('[data-testid="User-Name"]')) continue;
      if (div.closest('[role="group"]')) continue;
      if (div.closest('[role="button"]')) continue;
      // Skip longform title to avoid duplicate
      if (div.closest('[data-testid="twitter-article-title"]')) continue;
      const t = dedupeLines(div.innerText);
      if (t.length > 5) return t;
    }

    // 4. Build text by walking direct text-like children, excluding known noise
    const clone = article.cloneNode(true);
    clone.querySelectorAll('article').forEach(n => n.remove());
    clone.querySelectorAll('img, video, svg, [data-testid="tweetPhoto"], [data-testid="tweetVideo"]').forEach(n => n.remove());
    clone.querySelectorAll('[role="button"], [role="group"], [data-testid="like"], [data-testid="retweet"], [data-testid="reply"]').forEach(n => n.remove());
    clone.querySelectorAll('[data-testid="User-Name"]').forEach(n => n.remove());
    clone.querySelectorAll('time').forEach(n => n.remove());
    clone.querySelectorAll('a[href*="/status/"]').forEach(n => n.remove());

    const t = dedupeLines(clone.innerText);
    if (t.length > 0) return t;

    // 5. Absolute fallback
    const rawClone = article.cloneNode(true);
    rawClone.querySelectorAll('article').forEach(n => n.remove());
    return dedupeLines(rawClone.textContent);
  }

  function buildPromptExcerpt(data) {
    const parts = [];

    if (data.articleTitle) parts.push(`# ${data.articleTitle}`);
    if (data.authorHandle || data.authorName) {
      parts.push(`作者: ${[data.authorName, data.authorHandle].filter(Boolean).join(' ')}`.trim());
    }
    if (data.postText) parts.push(stripMarkdownArtifacts(data.postText));
    if (data.images.length > 0) parts.push(`媒体: ${data.images.length} 张`);

    const excerpt = normalizeWhitespace(parts.join('\n\n'));
    return excerpt.length > 1200 ? `${excerpt.slice(0, 1200).trim()}\n\n[截断]` : excerpt;
  }

  function extractPostData() {
    const article = findMainArticle();

    if (!article) {
      return { error: '未找到帖子内容，请确保你在 Twitter/X 帖子页面。如果页面刚加载，请稍等再试。' };
    }

    // ---- Author info ----
    let authorName = '';
    let authorHandle = '';

    const userNameContainer = article.querySelector('[data-testid="User-Name"]');
    if (userNameContainer) {
      const allSpans = Array.from(userNameContainer.querySelectorAll('span'));
      for (const sp of allSpans) {
        const txt = sp.textContent.trim();
        if (txt && !authorName) {
          authorName = txt;
          continue;
        }
        if (txt && txt.startsWith('@') && !authorHandle) {
          authorHandle = txt;
          break;
        }
      }
      if (!authorHandle) {
        const handleLink = userNameContainer.querySelector('a[href^="/"]');
        if (handleLink) {
          authorHandle = handleLink.getAttribute('href').replace('/', '@');
        }
      }
    }

    if (!authorHandle) {
      const handleMatch = article.textContent.match(/@[A-Za-z0-9_]+/);
      if (handleMatch) authorHandle = handleMatch[0];
    }

    // ---- Article title (for long-form posts) ----
    const articleTitleEl = article.querySelector('[data-testid="twitter-article-title"]');
    const articleTitle = articleTitleEl ? articleTitleEl.innerText.trim() : '';

    // ---- Post text ----
    const postText = extractTextFromArticle(article);

    // ---- Images ----
    const images = [];
    article.querySelectorAll('[data-testid="tweetPhoto"] img, [data-testid="tweetVideo"] img, [data-testid="videoPlayer"] img').forEach(img => {
      if (img.src && !images.includes(img.src)) images.push(img.src);
    });
    article.querySelectorAll('img').forEach(img => {
      if (img.src && img.src.includes('pbs.twimg.com') && !images.includes(img.src)) {
        images.push(img.src);
      }
    });

    // ---- Timestamp ----
    const timeEl = article.querySelector('time');
    const timestamp = timeEl ? (timeEl.getAttribute('datetime') || timeEl.textContent.trim()) : '';

    // ---- Post URL ----
    const linkEl = article.querySelector('a[href*="/status/"]');
    const postUrl = linkEl ? ('https://x.com' + linkEl.getAttribute('href')) : window.location.href;

    const normalizedPostText = dedupeLines(postText);

    return {
      authorName,
      authorHandle,
      articleTitle,
      postText: normalizedPostText,
      images,
      timestamp,
      postUrl,
      promptExcerpt: buildPromptExcerpt({
        authorName,
        authorHandle,
        articleTitle,
        postText: normalizedPostText,
        images
      })
    };
  }

  function generateMarkdown(data) {
    if (data.error) return data.error;

    let md = '';

    // Long-form article header
    if (data.articleTitle) {
      md += `# ${escapeMarkdown(data.articleTitle)}\n\n`;
    }

    const authorLine = [data.authorName, data.authorHandle].filter(Boolean).join(' ');
    if (authorLine) {
      md += `## ${escapeMarkdown(authorLine)}\n\n`;
    }

    if (data.postText) {
      // For long-form articles, postText is already markdown-formatted (with ## headers, lists, etc.)
      // For standard tweets, wrap in blockquote
      if (data.articleTitle) {
        md += `${data.postText}\n\n`;
      } else {
        md += `> ${data.postText.split('\n').join('\n> ')}\n\n`;
      }
    }

    if (data.images.length > 0) {
      data.images.forEach(imgUrl => {
        md += `![图片](${imgUrl})\n\n`;
      });
    }

    md += `---\n`;
    const metaParts = [];
    if (data.timestamp) metaParts.push(`*${data.timestamp}*`);
    metaParts.push(`[查看原帖](${data.postUrl})`);
    md += `${metaParts.join(' · ')}\n`;

    return normalizeWhitespace(md);
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractPost') {
      const data = extractPostData();
      sendResponse({ data, markdown: generateMarkdown(data) });
      return false; // synchronous response
    }
    return false;
  });

})();
