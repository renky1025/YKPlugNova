# Twitter/X 双语回复助手

一个 Chrome 浏览器扩展，帮助你阅读 Twitter/X 帖子并一键生成中英文双语回复。

## 功能特性

- **提取帖子内容**：自动将当前 Twitter/X 帖子提取为 Markdown 格式，包括文字、图片地址、作者信息
- **AI 智能回复**：调用 AI API 理解帖子内容，生成积极、友善、贴合主题的双语回复
- **一键复制**：支持分别复制中文回复、英文回复，或双语合并内容
- **多 AI 支持**：支持 OpenAI、Claude (Anthropic) 以及自定义 API 接口
- **隐私安全**：API Key 仅存储在本地浏览器中

## 安装方法

### 开发者模式安装

1. 打开 Chrome 浏览器，访问 `chrome://extensions/`
2. 开启右上角的「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `twitter-reply-assistant` 文件夹
5. 安装成功！

### 使用步骤

1. **配置 API**：
   - 点击扩展图标，展开「API 设置」
   - 选择 AI 提供商（OpenAI / Claude / 自定义）
   - 输入你的 API Key 和模型名称
   - 点击「保存设置」

2. **提取帖子**：
   - 在 Twitter/X 帖子页面，点击扩展图标
   - 点击「提取当前帖子」按钮
   - 帖子内容将以 Markdown 格式显示

3. **生成回复**：
   - 点击「生成双语回复」按钮
   - 等待 AI 生成回复

4. **复制使用**：
   - 分别复制中文回复、英文回复
   - 或复制双语合并内容

## API 配置说明

### OpenAI
- **提供商**: `OpenAI`
- **API Key**: 你的 OpenAI API Key
- **模型**: `gpt-4o-mini` 或 `gpt-4o`
- **URL**: 无需填写（使用默认）

### Claude (Anthropic)
- **提供商**: `Claude`
- **API Key**: 你的 Anthropic API Key
- **模型**: `claude-3-haiku-20240307` 或 `claude-3-sonnet-20240229`
- **URL**: 无需填写（使用默认）

### 自定义 API
- **提供商**: `自定义 API`
- **API Key**: 你的 API Key
- **模型**: 模型名称
- **URL**: 完整的 API 地址（如 `https://api.example.com/v1/chat/completions`）

## 文件结构

```
twitter-reply-assistant/
├── manifest.json      # Chrome 扩展配置
├── popup.html         # 弹出窗口 UI
├── popup.css          # 弹出窗口样式
├── popup.js           # 弹出窗口逻辑
├── content.js         # 内容脚本（提取帖子）
├── icons/             # 扩展图标
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md          # 说明文档
```

## 技术说明

- 使用 **Manifest V3** 标准
- 内容脚本通过 DOM 选择器提取 Twitter/X 帖子数据
- AI 调用通过 `fetch` 直接在前端完成
- API Key 使用 `chrome.storage.local` 本地存储
- 生成的回复严格控制在 280 字符以内，适配 Twitter 限制

## 注意事项

1. 需要在 Twitter/X 帖子页面使用（`twitter.com/*` 或 `x.com/*`）
2. Twitter/X 的 DOM 结构可能会变化，如果提取失败请检查页面是否为标准帖子页
3. API 调用会产生费用，请注意使用量
4. 建议使用轻量级模型（如 gpt-4o-mini、claude-3-haiku）以节省成本

## License

MIT
