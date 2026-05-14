document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const extractBtn = document.getElementById('extract-btn');
  const generateBtn = document.getElementById('generate-btn');
  const postMarkdown = document.getElementById('post-markdown');
  const replyLoading = document.getElementById('reply-loading');
  const replyResult = document.getElementById('reply-result');
  const replyZh = document.getElementById('reply-zh');
  const replyEn = document.getElementById('reply-en');
  const copyBilingualBtn = document.getElementById('copy-bilingual');
  const toast = document.getElementById('toast');
  const toggleSettings = document.getElementById('toggle-settings');
  const settingsContent = document.getElementById('settings-content');
  const saveSettingsBtn = document.getElementById('save-settings');
  const aiProvider = document.getElementById('ai-provider');
  const apiKey = document.getElementById('api-key');
  const customUrlGroup = document.getElementById('custom-url-group');
  const customUrl = document.getElementById('custom-url');
  const modelName = document.getElementById('model-name');
  const testBtn = document.getElementById('test-btn');
  const testResult = document.getElementById('test-result');

  let extractedData = null;

  // Load settings
  const settings = await chrome.storage.local.get(['aiProvider', 'apiKey', 'customUrl', 'modelName']);
  if (settings.aiProvider) aiProvider.value = settings.aiProvider;
  if (settings.apiKey) apiKey.value = settings.apiKey;
  if (settings.customUrl) customUrl.value = settings.customUrl;
  if (settings.modelName) modelName.value = settings.modelName;

  // Default models
  const defaultModels = {
    openai: 'gpt-4o-mini',
    claude: 'claude-3-haiku-20240307',
    openrouter: 'openai/gpt-4o-mini',
    custom: ''
  };

  if (!settings.modelName) {
    modelName.value = defaultModels[aiProvider.value] || '';
  }

  // Toggle settings
  toggleSettings.addEventListener('click', () => {
    settingsContent.classList.toggle('hidden');
    toggleSettings.textContent = settingsContent.classList.contains('hidden') ? '▼' : '▲';
  });

  // Toggle custom URL
  aiProvider.addEventListener('change', () => {
    customUrlGroup.style.display = aiProvider.value === 'custom' ? 'block' : 'none';
    if (!modelName.value) {
      modelName.value = defaultModels[aiProvider.value] || '';
    }
  });

  // Save settings
  saveSettingsBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({
      aiProvider: aiProvider.value,
      apiKey: apiKey.value,
      customUrl: customUrl.value,
      modelName: modelName.value
    });
    showToast('设置已保存');
  });

  // Test connection
  testBtn.addEventListener('click', async () => {
    const key = apiKey.value.trim();
    if (!key) {
      testResult.className = 'test-result error';
      testResult.textContent = '请先输入 API Key';
      testResult.classList.remove('hidden');
      return;
    }

    const model = modelName.value.trim() || defaultModels[aiProvider.value];
    if (!model) {
      testResult.className = 'test-result error';
      testResult.textContent = '请设置模型名称';
      testResult.classList.remove('hidden');
      return;
    }

    testBtn.disabled = true;
    testBtn.textContent = '测试中...';
    testResult.classList.add('hidden');

    try {
      const msg = await testApiConnection(key, aiProvider.value, model, customUrl.value.trim());
      testResult.className = 'test-result success';
      testResult.textContent = `✅ 连接成功 (${msg})`;
    } catch (err) {
      testResult.className = 'test-result error';
      testResult.textContent = `❌ ${err.message}`;
    } finally {
      testResult.classList.remove('hidden');
      testBtn.disabled = false;
      testBtn.textContent = '🔌 测试连接';
    }
  });

  // Extract post
  extractBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab.url.includes('twitter.com') && !tab.url.includes('x.com')) {
        showToast('请在 Twitter/X 页面使用');
        return;
      }

      extractBtn.disabled = true;
      extractBtn.textContent = '提取中...';

      let response = null;

      try {
        // First try: content script may already be injected
        response = await chrome.tabs.sendMessage(tab.id, { action: 'extractPost' });
      } catch (e) {
        // If not injected, inject it dynamically
        if (e.message && (
          e.message.includes('Receiving end does not exist') ||
          e.message.includes('Could not establish connection')
        )) {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });
          // Wait a moment for script initialization
          await new Promise(r => setTimeout(r, 300));
          response = await chrome.tabs.sendMessage(tab.id, { action: 'extractPost' });
        } else {
          throw e;
        }
      }

      if (response && response.markdown) {
        postMarkdown.value = response.markdown;
        extractedData = response.data;
        generateBtn.disabled = false;
        if (response.data && response.data.error) {
          showToast('提取内容异常: ' + response.data.error);
        } else {
          showToast('帖子提取成功');
        }
      } else {
        showToast('提取失败，请重试');
      }
    } catch (err) {
      showToast('错误: ' + (err.message || String(err)));
    } finally {
      extractBtn.disabled = false;
      extractBtn.textContent = '📥 提取当前帖子';
    }
  });

  // Generate reply
  generateBtn.addEventListener('click', async () => {
    if (!extractedData || extractedData.error) {
      showToast('请先提取帖子内容');
      return;
    }

    const key = apiKey.value.trim();
    if (!key) {
      showToast('请先设置 API Key');
      settingsContent.classList.remove('hidden');
      return;
    }

    const model = modelName.value.trim() || defaultModels[aiProvider.value];
    if (!model) {
      showToast('请设置模型名称');
      return;
    }

    generateBtn.disabled = true;
    replyLoading.classList.remove('hidden');
    replyResult.classList.add('hidden');

    try {
      const reply = await generateBilingualReply(extractedData, key, aiProvider.value, model, customUrl.value.trim());

      replyZh.value = reply.zh;
      replyEn.value = reply.en;

      replyResult.classList.remove('hidden');
      showToast('回复生成成功');
    } catch (err) {
      showToast('生成失败: ' + err.message);
    } finally {
      generateBtn.disabled = false;
      replyLoading.classList.add('hidden');
    }
  });

  // Copy buttons
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const targetId = btn.getAttribute('data-target');
      const textarea = document.getElementById(targetId);

      await copyText(textarea.value, textarea);
      showToast('已复制到剪贴板');
    });
  });

  copyBilingualBtn.addEventListener('click', async () => {
    const bilingualText = [replyZh.value.trim(), replyEn.value.trim()].filter(Boolean).join('\n\n');
    await copyText(bilingualText, replyZh);
    showToast('双语回复已复制');
  });

  // Show toast
  function showToast(message) {
    toast.textContent = message;
    toast.classList.remove('hidden');
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 2000);
  }

  async function copyText(text, fallbackTextarea) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      fallbackTextarea.focus();
      fallbackTextarea.select();
      document.execCommand('copy');
    }
  }

  function normalizeWhitespace(text) {
    return (text || '')
      .replace(/\r/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  function buildPromptContext(data) {
    const source = normalizeWhitespace(data.promptExcerpt || data.postText || '');
    const excerpt = source.length > 900 ? `${source.slice(0, 900).trim()}\n[截断]` : source;
    const parts = [];

    if (data.authorHandle || data.authorName) {
      parts.push(`author=${[data.authorName, data.authorHandle].filter(Boolean).join(' ')}`.trim());
    }
    if (data.articleTitle) parts.push(`title=${data.articleTitle}`);
    parts.push(`content=\n${excerpt}`);
    if (data.images.length > 0) parts.push(`media=${data.images.length}`);

    return parts.join('\n');
  }

  function parseTaggedReply(content, tag) {
    const match = content.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return match ? normalizeWhitespace(match[1]) : '';
  }

  function stripTags(text) {
    return normalizeWhitespace((text || '').replace(/<\/?(zh|en)>/gi, ''));
  }

  function looksLikeEnglish(text) {
    if (!text) return false;
    const sample = text.slice(0, 80);
    const latin = sample.replace(/[^A-Za-z\s]/g, '').length;
    return latin > sample.length * 0.45;
  }

  function looksLikeChinese(text) {
    if (!text) return false;
    return /[\u4e00-\u9fff]/.test(text.slice(0, 80));
  }

  // Test API connection (minimal call)
  async function testApiConnection(apiKey, provider, model, customApiUrl) {
    const isOpenRouter = provider === 'openrouter' || customApiUrl.includes('openrouter.ai');
    const url = provider === 'custom' ? customApiUrl
              : provider === 'claude' ? 'https://api.anthropic.com/v1/messages'
              : provider === 'openrouter' ? 'https://openrouter.ai/api/v1/chat/completions'
              : 'https://api.openai.com/v1/chat/completions';

    let response;

    if (provider === 'claude') {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model,
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Reply with one word: OK' }]
        })
      });
    } else {
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      };

      if (isOpenRouter) {
        headers['HTTP-Referer'] = 'https://chrome.google.com/webstore';
        headers['X-Title'] = 'Twitter Reply AI Assistant';
      }

      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Reply with one word: OK' }],
          max_tokens: 10
        })
      });
    }

    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');

    if (!response.ok) {
      if (isJson) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `HTTP ${response.status}`);
      }
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: 返回了非 JSON 响应`);
    }

    if (!isJson) {
      throw new Error(`返回了非 JSON 响应 (${contentType})`);
    }

    const result = await response.json();
    let content = '';

    if (provider === 'claude') {
      content = result.content?.[0]?.text || '';
    } else {
      content = result.choices?.[0]?.message?.content || '';
    }

    if (!content) {
      throw new Error('API 返回了空内容');
    }

    return content.trim();
  }

  // Generate reply via AI API
  async function generateBilingualReply(data, apiKey, provider, model, customApiUrl) {
    const systemPrompt = [
      '为 X/Twitter 帖子写双语回复。',
      '像真人随手评论，不要 AI 腔、总结腔、分点腔。',
      '语气以肯定、积极认同、表达收获为主。',
      '紧扣原帖具体信息，可以表达赞同、共鸣、被启发，不要反问，不要质疑，不要辩论。',
      '中文 45-90 字；英文 55-120 chars。',
      '只输出标签：<zh>...</zh><en>...</en>'
    ].join('\n');

    const userPrompt = [
      '基于下面内容写一条中文回复和一条英文回复。',
      '要求：自然、简短、偏正向，突出认可和收获感，不要解释，不要客套，不要复述整帖，不要用反问句。',
      buildPromptContext(data)
    ].join('\n\n');

    let response;
    const isOpenRouter = provider === 'openrouter' || customApiUrl.includes('openrouter.ai');
    const url = provider === 'custom' ? customApiUrl
              : provider === 'claude' ? 'https://api.anthropic.com/v1/messages'
              : provider === 'openrouter' ? 'https://openrouter.ai/api/v1/chat/completions'
              : 'https://api.openai.com/v1/chat/completions';

    if (provider === 'claude') {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: model,
          max_tokens: 260,
          system: systemPrompt,
          messages: [
            { role: 'user', content: userPrompt }
          ]
        })
      });
    } else {
      // openai or custom (OpenAI-compatible)
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      };

      if (isOpenRouter) {
        headers['HTTP-Referer'] = 'https://chrome.google.com/webstore';
        headers['X-Title'] = 'Twitter Reply AI Assistant';
      }

      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.8,
          max_tokens: 260
        })
      });
    }

    // Check if response is JSON before parsing
    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');

    if (!response.ok) {
      if (isJson) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || error.message || `API 错误: ${response.status}`);
      } else {
        const text = await response.text().catch(() => '');
        const snippet = text.slice(0, 200).replace(/\s+/g, ' ');
        throw new Error(`API 错误 ${response.status}: 返回了非 JSON 响应。可能是 API Key 无效、URL 错误或网络被拦截。响应片段: ${snippet}`);
      }
    }

    if (!isJson) {
      const text = await response.text().catch(() => '');
      const snippet = text.slice(0, 200).replace(/\s+/g, ' ');
      throw new Error(`API 返回了非 JSON 响应 (${contentType})。响应片段: ${snippet}`);
    }

    const result = await response.json();
    let content = '';

    if (provider === 'claude') {
      content = result.content?.[0]?.text || '';
    } else {
      content = result.choices?.[0]?.message?.content || '';
    }

    if (!content) {
      throw new Error('API 返回了空内容，请检查模型名称是否正确');
    }

    // Parse the response
    let zh = parseTaggedReply(content, 'zh');
    let en = parseTaggedReply(content, 'en');

    if (!zh || !en) {
      const plain = stripTags(content);
      const lines = plain.split('\n').map(line => line.trim()).filter(Boolean);
      if (lines.length >= 2) {
        zh = zh || lines[0];
        en = en || lines.slice(1).join(' ');
      }
    }

    if (looksLikeEnglish(zh) && looksLikeChinese(en)) {
      [zh, en] = [en, zh];
    }

    if (!zh || !en) {
      throw new Error('回复解析失败，请重试或调整模型');
    }

    return { zh, en };
  }
});
