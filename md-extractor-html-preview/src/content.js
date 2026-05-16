import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { gfm, tables, strikethrough } from 'turndown-plugin-gfm';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Promote "fake" headings in the cloned DOM to real <h2> elements before
 * passing to Turndown.  Many platforms (Substack, Medium, Ghost, newsletters)
 * style headings with <p><strong>…</strong></p> or large inline font-size
 * rather than semantic <h2>/<h3> tags.
 *
 * Strategy
 *  1. <p> or <div> whose sole non-whitespace content is a single <strong>/<b>
 *     → promote to <h2>
 *  2. <strong>/<b> with an inline font-size ≥ 18px that is the only content
 *     of its parent block → promote parent to <h2>
 *  3. Any element with a role="heading" attribute → promote to <h2>
 */
function promoteFakeHeadings(container) {
  // Pattern 1 & 2: <p> / <div> wrapping a lone <strong> or <b>
  const blocks = container.querySelectorAll('p, div');
  blocks.forEach(block => {
    // Collect meaningful child nodes (skip pure-whitespace text nodes)
    const children = Array.from(block.childNodes).filter(n => {
      if (n.nodeType === Node.TEXT_NODE) return n.textContent.trim() !== '';
      return true;
    });

    if (children.length === 1) {
      const child = children[0];
      if (
        child.nodeType === Node.ELEMENT_NODE &&
        (child.tagName === 'STRONG' || child.tagName === 'B')
      ) {
        const text = child.textContent.trim();
        // Skip very short strings or strings that look like inline bold
        if (text.length > 3 && text.length < 200) {
          // Check inline font-size or just promote unconditionally when it's
          // the sole child (common enough pattern on all major platforms)
          const fontSize = parseFloat(child.style && child.style.fontSize) || 0;
          if (fontSize === 0 || fontSize >= 16) {
            const h2 = container.ownerDocument.createElement('h2');
            h2.textContent = text;
            block.replaceWith(h2);
          }
        }
      }
    }
  });

  // Pattern 3: role="heading"
  container.querySelectorAll('[role="heading"]').forEach(el => {
    const level = parseInt(el.getAttribute('aria-level'), 10) || 2;
    const tag = `h${Math.min(Math.max(level, 1), 6)}`;
    const h = container.ownerDocument.createElement(tag);
    h.textContent = el.textContent.trim();
    el.replaceWith(h);
  });
}

// ─── Pre-Readability DOM fixes ───────────────────────────────────────────────

/**
 * Fix 1 — Neutralise heading class/id weights.
 *
 * Readability._cleanHeaders() deletes <h2>-<h6> elements whose class or id
 * name scores negatively (strings like "header", "title", "nav", "widget",
 * "bold" etc. trigger a -25 weight).  Clearing those attributes means every
 * heading is treated as neutral and survives the cleanup pass.
 */
function neutraliseHeadingClassWeights(doc) {
  doc.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => {
    h.removeAttribute('class');
    h.removeAttribute('id');
  });
}

/**
 * Fix 2 — Unwrap deeply-nested heading containers.
 *
 * Some platforms wrap each heading in several single-child <div> layers:
 *   <div><div><div><h2>Title</h2></div></div></div>
 *
 * Readability scores candidate nodes by the text length of their subtree.
 * A <div> that contains ONLY a heading contributes zero "content score", so
 * it and its heading may be pruned entirely.
 *
 * This function walks every heading upward through its ancestor chain and
 * removes any single-child wrapper <div>/<section>/<article> so that the
 * heading becomes a direct sibling of nearby content blocks.
 */
function unwrapHeadingContainers(doc) {
  doc.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(heading => {
    let parent = heading.parentElement;

    while (parent) {
      const tag = parent.tagName;
      if (tag !== 'DIV' && tag !== 'SECTION' && tag !== 'ARTICLE') break;

      // Only unwrap if this wrapper's sole meaningful child is the heading
      const meaningfulChildren = Array.from(parent.childNodes).filter(n =>
        !(n.nodeType === Node.TEXT_NODE && n.textContent.trim() === '')
      );
      if (meaningfulChildren.length !== 1) break;

      const grandparent = parent.parentElement;
      if (!grandparent) break;

      // Move heading directly before the wrapper, then remove the empty wrapper
      grandparent.insertBefore(heading, parent);
      parent.remove();
      parent = grandparent;
    }
  });
}

// ─── Table preservation helpers ─────────────────────────────────────────────

/**
 * Readability may strip or collapse <table> elements it considers
 * "non-content" (e.g. layout tables).  To prevent this we mark every
 * table with a data-keep attribute before parsing, then after parsing
 * we verify the tables survived.  If they didn't, we fall back to
 * injecting the table HTML back into the article content.
 */
function markTables(doc) {
  doc.querySelectorAll('table').forEach((table, i) => {
    table.setAttribute('data-keep-table', i);
    // Ensure the table has at least one text node so Readability scores it
    // positively (empty tables are pruned immediately).
    if (!table.textContent.trim()) return;
    // Add a content-weight class so Readability doesn't treat it as layout
    table.classList.add('page');
  });
}

/**
 * Collect serialised HTML of every marked table BEFORE Readability runs.
 * Returns a Map<index, outerHTML>.
 */
function collectTables(doc) {
  const map = new Map();
  doc.querySelectorAll('table[data-keep-table]').forEach(table => {
    const idx = table.getAttribute('data-keep-table');
    map.set(idx, table.outerHTML);
  });
  return map;
}

// ─── Message listener ────────────────────────────────────────────────────────

// Wait for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extract') {
    try {
      // Readability modifies the document, so we clone it
      const documentClone = document.cloneNode(true);

      // ── Pre-process BEFORE Readability ──────────────────────────────────
      // 1. Strip class/id from headings so _cleanHeaders won't penalise them
      neutraliseHeadingClassWeights(documentClone);
      // 2. Bubble headings out of single-child wrapper divs so they survive
      //    Readability's content-score pruning pass
      unwrapHeadingContainers(documentClone);
      // 3. Mark all tables so they survive Readability's cleanup pass
      markTables(documentClone);
      // Snapshot table HTML before Readability may remove them
      const tableSnapshots = collectTables(documentClone);
      // ────────────────────────────────────────────────────────────────────

      const reader = new Readability(documentClone);
      const article = reader.parse();
      
      if (!article) {
        sendResponse({ success: false, error: 'Failed to extract article content. The page might not have a clear main content area.' });
        return true;
      }

      // ── Post-process article.content to promote fake headings ──────────
      // Parse the HTML string Readability returned into a live DOM fragment
      const parser = new DOMParser();
      const articleDoc = parser.parseFromString(article.content, 'text/html');
      promoteFakeHeadings(articleDoc.body);

      // ── Restore tables that Readability may have dropped ────────────────
      // If the snapshot had tables but the parsed article doesn't, append them.
      if (tableSnapshots.size > 0) {
        const survivingTables = new Set();
        articleDoc.querySelectorAll('table[data-keep-table]').forEach(t => {
          survivingTables.add(t.getAttribute('data-keep-table'));
        });
        tableSnapshots.forEach((html, idx) => {
          if (!survivingTables.has(idx)) {
            // Append the missing table wrapped in a div so Turndown sees it
            const wrapper = articleDoc.createElement('div');
            wrapper.innerHTML = html;
            articleDoc.body.appendChild(wrapper);
          }
        });
      }

      const processedContent = articleDoc.body.innerHTML;
      // ───────────────────────────────────────────────────────────────────
      
      const turndownService = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-'
      });

      // ── Enable GFM plugin: tables + strikethrough ───────────────────────
      turndownService.use(gfm);
      
      // Basic rule to preserve some elements or clean up
      turndownService.remove(['script', 'noscript', 'style']);

      // Override the default heading rule to always trim inner content.
      // Turndown passes content as-is, so leading/trailing newlines from
      // deeply-nested or unwrapped <h2> elements produce invalid markdown:
      //   "## \n\nThe 90/10 Rule"  ← parser doesn't see this as a heading
      // With trim() it becomes:  "## The 90/10 Rule"  ✓
      turndownService.addRule('headingTrimmed', {
        filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
        replacement: function (content, node) {
          const level = Number(node.nodeName.charAt(1));
          const prefix = '#'.repeat(level);
          const text = content.trim().replace(/\n+/g, ' '); // collapse inner newlines too
          return text ? `\n\n${prefix} ${text}\n\n` : '';
        }
      });

      // Custom rule: treat a <p> containing ONLY bold text as an h2
      // (safety net for anything promoteFakeHeadings may have missed)
      turndownService.addRule('boldOnlyParagraph', {
        filter: function (node) {
          if (node.nodeName !== 'P') return false;
          const children = Array.from(node.childNodes).filter(n =>
            !(n.nodeType === Node.TEXT_NODE && n.textContent.trim() === '')
          );
          if (children.length !== 1) return false;
          const child = children[0];
          return (
            child.nodeType === Node.ELEMENT_NODE &&
            (child.nodeName === 'STRONG' || child.nodeName === 'B') &&
            child.textContent.trim().length > 3
          );
        },
        replacement: function (content) {
          const text = content.replace(/^\*\*|\*\*$/g, '').trim();
          return `\n\n## ${text}\n\n`;
        }
      });
      
      let markdown = turndownService.turndown(processedContent);

      // Fallback: fix any residual broken headings where the ## prefix is
      // separated from its text by whitespace/newlines, e.g.:
      //   "## \n\nSome Title"  →  "## Some Title"
      markdown = markdown.replace(/^(#{1,6})[ \t]*\n+[ \t]*/gm, '$1 ');
      
      // Ensure there's a title header at the top.
      // Use regex to detect any existing H1 line to avoid false negatives from
      // minor differences (spacing, special chars) between article.title and the
      // actual heading text extracted from content.
      let finalMarkdown = markdown;
      const hasH1 = /^#\s+\S/m.test(markdown);
      if (article.title && !hasH1) {
        finalMarkdown = `# ${article.title}\n\n${markdown}`;
      }
      
      sendResponse({ 
        success: true, 
        title: article.title, 
        markdown: finalMarkdown,
        byline: article.byline 
      });
    } catch (e) {
      console.error("Extraction error:", e);
      sendResponse({ success: false, error: e.toString() });
    }
  }
  return true; // Keep channel open
});
