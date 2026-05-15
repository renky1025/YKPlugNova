import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';

// Wait for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extract') {
    try {
      // Readability modifies the document, so we clone it
      const documentClone = document.cloneNode(true);
      const reader = new Readability(documentClone);
      const article = reader.parse();
      
      if (!article) {
        sendResponse({ success: false, error: 'Failed to extract article content. The page might not have a clear main content area.' });
        return true;
      }
      
      const turndownService = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced'
      });
      
      // Basic rule to preserve some elements or clean up
      turndownService.remove(['script', 'noscript', 'style']);
      
      const markdown = turndownService.turndown(article.content);
      
      // Ensure there's a title header at the top
      let finalMarkdown = markdown;
      if (article.title && !markdown.startsWith('# ' + article.title)) {
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
