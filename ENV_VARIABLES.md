# 环境变量配置说明

## 📋 概述

`server.js` 已修改为**优先从环境变量读取配置**,失败时降级到 `config.yaml`。

这样设计的优势:
- ✅ **安全**: 敏感信息不会出现在代码仓库中
- ✅ **灵活**: 不同环境(开发/生产)可使用不同配置
- ✅ **云友好**: 支持 Vercel、Render 等平台部署

---

## 🔧 必需环境变量

部署到 Vercel 时,**至少需要配置以下变量**:

| 变量名 | 说明 | 示例值 |
|--------|------|--------|
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 | `sk-xxxxx` |
| `WEIXIN_APP_ID` | 微信公众号 AppID | `wx1234567890abcdef` |
| `WEIXIN_APP_SECRET` | 微信公众号 AppSecret | `xxxxxxxxxxxxxxxxxxxxxxxx` |

---

## 📦 完整环境变量列表

### AI 模型配置

#### DeepSeek
```bash
DEEPSEEK_API_KEY=sk-xxxxx
DEEPSEEK_API_BASE=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_TEMPERATURE=0.8
DEEPSEEK_MAX_TOKENS=8000
```

#### 通义千问
```bash
TONGYI_API_KEY=sk-xxxxx
TONGYI_API_BASE=https://dashscope.aliyuncs.com/compatible-mode/v1
TONGYI_MODEL=qwen-turbo
TONGYI_TEMPERATURE=0.8
TONGYI_MAX_TOKENS=8000
```

#### SiliconFlow
```bash
SILICONFLOW_API_KEY=sk-xxxxx
SILICONFLOW_API_BASE=https://api.siliconflow.cn/v1
SILICONFLOW_MODEL=deepseek-ai/DeepSeek-V3
SILICONFLOW_IMAGE_MODEL=black-forest-labs/FLUX.1-schnell
SILICONFLOW_TEMPERATURE=0.8
SILICONFLOW_MAX_TOKENS=8000
```

#### 文心一言
```bash
WENXIN_API_KEY=xxxxx
WENXIN_SECRET_KEY=xxxxx
WENXIN_MODEL=ernie-bot-4
WENXIN_TEMPERATURE=0.8
WENXIN_MAX_TOKENS=4000
```

#### AI 提供商选择
```bash
AI_PROVIDER=deepseek  # 可选: deepseek | tongyi | wenxin | siliconflow
```

---

### 搜索配置

#### Tavily 搜索
```bash
TAVILY_API_KEY=tvly-dev-xxxxx
```

**获取方式**: [https://api.tavily.com/](https://api.tavily.com/)

---

### 微信公众号配置

```bash
WEIXIN_ENABLED=true
WEIXIN_APP_ID=wx1234567890abcdef
WEIXIN_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
WEIXIN_AUTHOR=公众号
WEIXIN_DEFAULT_THUMB_MEDIA_ID=
WEIXIN_OPEN_COMMENT=true
WEIXIN_PUBLISH_DIRECTLY=false
```

**获取方式**:
1. 登录 [mp.weixin.qq.com](https://mp.weixin.qq.com/)
2. 开发 → 基本配置
3. 获取 AppID 和 AppSecret

---

### 新闻抓取配置

```bash
SCRAPER_SOURCE=baidu
SCRAPER_MAX_ARTICLES=5
SCRAPER_TIMEOUT=15
SCRAPER_DELAY=2
SCRAPER_USER_AGENT=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36
```

---

### 文章改写配置

```bash
REWRITE_STYLE=professional
REWRITE_ADD_SUMMARY=true
REWRITE_ADD_ENDING=true
REWRITE_TARGET_WORDS=1200
```

**可选样式**:
- `professional` - 专业
- `casual` - 轻松
- `storytelling` - 故事化
- `analytical` - 深度分析

---

### 排版配置

```bash
FORMAT_ADD_COVER_PLACEHOLDER=true
FORMAT_ADD_META=true
FORMAT_ADD_TAGS=true
FORMAT_TITLE_LEVEL=h1
```

---

### 输出配置

```bash
OUTPUT_DIRECTORY=./output
OUTPUT_FILENAME_FORMAT=datetime
OUTPUT_SAVE_RAW=false
```

**文件名格式**:
- `datetime` - 按日期时间命名
- `title` - 按文章标题命名
- `slug` - 按URL友好命名

---

### IMA 笔记配置(可选)

```bash
IMA_CLIENT_ID=xxxxx
IMA_CLIENT_SECRET=xxxxx
```

---

## 🚀 在 Vercel 配置环境变量

### 步骤 1: 进入项目设置

1. 打开 Vercel 项目控制台
2. 点击 **Settings** → **Environment Variables**

### 步骤 2: 添加必需变量

点击 **"Add New"**,逐个添加以下**必需**变量:

| Key | Value | Environment |
|-----|-------|-------------|
| `DEEPSEEK_API_KEY` | 你的 DeepSeek API Key | Production, Preview, Development |
| `WEIXIN_APP_ID` | 你的微信 AppID | Production, Preview, Development |
| `WEIXIN_APP_SECRET` | 你的微信 AppSecret | Production, Preview, Development |

### 步骤 3: 添加可选变量

根据需要添加其他可选变量,如:
- `SILICONFLOW_API_KEY` (如需 AI 配图功能)
- `TAVILY_API_KEY` (如需全网搜索功能)

### 步骤 4: 重新部署

添加环境变量后,点击 **Deployments** → 右上角 **Redeploy**

---

## 🧪 本地开发使用环境变量

### 方法 1: 使用 .env 文件(需安装 dotenv)

```bash
npm install dotenv
```

在项目根目录创建 `.env` 文件:
```bash
DEEPSEEK_API_KEY=sk-xxxxx
WEIXIN_APP_ID=wx1234567890abcdef
WEIXIN_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
```

修改 `server.js` 顶部添加:
```javascript
require('dotenv').config();
```

### 方法 2: 命令行传递

```bash
DEEPSEEK_API_KEY=sk-xxxxx WEIXIN_APP_ID=wx123456 WEIXIN_APP_SECRET=xxxxx npm start
```

### 方法 3: PowerShell(Windows)

```powershell
$env:DEEPSEEK_API_KEY="sk-xxxxx"
$env:WEIXIN_APP_ID="wx1234567890abcdef"
$env:WEIXIN_APP_SECRET="xxxxxxxxxxxxxxxxxxxxxxxx"
npm start
```

---

## ⚠️ 安全注意事项

1. **永远不要**将 `.env` 文件提交到 Git
2. `.gitignore` 已配置排除 `.env` 文件
3. 生产环境使用 `.env.production` 或平台环境变量
4. 定期更换 API 密钥
5. 为不同环境使用不同的密钥

---

## 🔍 检查环境变量是否生效

启动服务器后,查看控制台日志:

```
[Config] 从环境变量加载配置  ← 表示使用环境变量
```

如果看到:
```
[Config] 从 config.yaml 加载配置  ← 表示使用配置文件
```

说明环境变量未正确设置。

---

## 📚 参考文档

- [Vercel 环境变量文档](https://vercel.com/docs/projects/environment-variables)
- [DeepSeek API 文档](https://platform.deepseek.com/docs)
- [微信公众号开发文档](https://developers.weixin.qq.com/doc/)
