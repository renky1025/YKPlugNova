// Background script for Twitter/X Bilingual Reply Assistant
// Currently not required for core functionality, but kept for future enhancements

chrome.runtime.onInstalled.addListener(() => {
  console.log('Twitter/X 双语回复助手已安装');
});

// Handle any background tasks if needed in the future
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Placeholder for background processing
  return true;
});
