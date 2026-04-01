# 部署前检查清单

## ✅ 安全检查

- [x] `.gitignore` 已创建并配置正确
- [x] `config.yaml` 不会被提交(包含真实 API 密钥)
- [x] `data/` 目录不会被提交
- [x] `output/` 目录不会被提交
- [x] `config.example.yaml` 已创建(无敏感信息)
- [x] `.env.example` 已创建(环境变量示例)

## ✅ 文件清单

### 核心文件(会被提交):
- ✅ `server.js` - Express 服务器
- ✅ `package.json` - 依赖配置(v3.0.4)
- ✅ `vercel.json` - Vercel 部署配置
- ✅ `.gitignore` - Git 忽略规则
- ✅ `public/` - 前端静态文件
- ✅ `src/` - 核心业务逻辑

### 配置文件:
- ✅ `config.example.yaml` - 配置模板
- ✅ `.env.example` - 环境变量模板

### 文档文件:
- ✅ `README.md` - 项目说明
- ✅ `DEPLOY_TO_VERCEL.md` - Vercel 部署详细指南
- ✅ `DEPLOYMENT_CHECKLIST.md` - 本检查清单

### 可选文件(建议不提交):
- ⚠️ `backup_v*.py` - 备份脚本
- ⚠️ `start-server.bat` - Windows 启动脚本
- ⚠️ `开发踩坑说明补丁.html` - 开发文档

## ⚠️ 敏感文件(已排除):
- ❌ `config.yaml` - 包含真实 API 密钥
- ❌ `data/` - 用户数据
- ❌ `output/` - 生成的文章
- ❌ `.env` - 环境变量文件
- ❌ `*.log` - 日志文件

## 🔍 需要注意的问题

### 1. server.js 依赖 config.yaml

**问题**: 当前代码直接读取 `config.yaml`,部署后无法使用。

**影响**: API 密钥无法读取,所有功能失效。

**解决方案**:

**选项 A - 修改代码支持环境变量** (推荐):
修改 `server.js` 的 `loadConfig()` 函数,优先读取环境变量,失败时降级到 `config.yaml`。

```javascript
function loadConfig() {
  // 优先尝试环境变量
  if (process.env.DEEPSEEK_API_KEY) {
    return {
      ai: {
        provider: process.env.AI_PROVIDER || 'deepseek',
        deepseek: {
          api_key: process.env.DEEPSEEK_API_KEY,
          api_base: process.env.DEPSEEK_API_BASE || 'https://api.deepseek.com/v1',
          model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
          temperature: parseFloat(process.env.DEEPSEEK_TEMPERATURE || '0.8'),
          max_tokens: parseInt(process.env.DEEPSEEK_MAX_TOKENS || '8000')
        },
        siliconflow: {
          api_key: process.env.SILICONFLOW_API_KEY,
          api_base: process.env.SILICONFLOW_API_BASE || 'https://api.siliconflow.cn/v1',
          model: process.env.SILICONFLOW_MODEL || 'deepseek-ai/DeepSeek-V3',
          image_model: process.env.SILICONFLOW_IMAGE_MODEL || 'black-forest-labs/FLUX.1-schnell',
          temperature: parseFloat(process.env.SILICONFLOW_TEMPERATURE || '0.8'),
          max_tokens: parseInt(process.env.SILICONFLOW_MAX_TOKENS || '8000')
        }
      },
      tavily: {
        api_key: process.env.TAVILY_API_KEY
      },
      weixin: {
        enabled: true,
        app_id: process.env.WEIXIN_APP_ID,
        app_secret: process.env.WEIXIN_APP_SECRET,
        author: process.env.WEIXIN_AUTHOR || '公众号',
        default_thumb_media_id: process.env.WEIXIN_DEFAULT_THUMB_MEDIA_ID || '',
        open_comment: process.env.WEIXIN_OPEN_COMMENT === 'true',
        publish_directly: process.env.WEIXIN_PUBLISH_DIRECTLY === 'true'
      },
      scraper: {
        source: process.env.SCRAPER_SOURCE || 'baidu',
        max_articles: parseInt(process.env.SCRAPER_MAX_ARTICLES || '5'),
        timeout: parseInt(process.env.SCRAPER_TIMEOUT || '15'),
        delay: parseInt(process.env.SCRAPER_DELAY || '2'),
        user_agent: process.env.SCRAPER_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      rewrite: {
        style: process.env.REWRITE_STYLE || 'professional',
        add_summary: process.env.REWRITE_ADD_SUMMARY !== 'false',
        add_ending: process.env.REWRITE_ADD_ENDING !== 'false',
        target_words: parseInt(process.env.REWRITE_TARGET_WORDS || '1200')
      },
      format: {
        add_cover_placeholder: process.env.FORMAT_ADD_COVER_PLACEHOLDER !== 'false',
        add_meta: process.env.FORMAT_ADD_META !== 'false',
        add_tags: process.env.FORMAT_ADD_TAGS !== 'false',
        title_level: process.env.FORMAT_TITLE_LEVEL || 'h1'
      }
    };
  }

  // 降级到 config.yaml
  const configPath = path.join(__dirname, 'config.yaml');
  if (fs.existsSync(configPath)) {
    return yaml.load(fs.readFileSync(configPath, 'utf8'));
  }

  throw new Error('配置文件 config.yaml 不存在且环境变量未设置');
}
```

**选项 B - 提交安全的 config.yaml 到 Git** (不推荐):
创建一个包含示例值的 `config.yaml` 并提交,但这样会导致代码在本地无法直接运行。

### 2. Vercel 免费版限制

**执行时间限制**: Serverless Functions 最长 60 秒
- AI 生成文章可能超时
- 抓取大量新闻可能超时

**解决方案**: 已使用 SSE 流式推送,可缓解部分问题。

### 3. 无持久化存储

Vercel 无文件系统持久化:
- `data/` 目录无法保存
- `output/` 目录无法保存
- 每次部署都会清空

**解决方案**:
- 使用外部数据库(Vercel Postgres)
- 使用对象存储(AWS S3, 阿里云 OSS)
- 或者改用 Render.com/Railway 等支持持久化的平台

## 📋 下一步行动

### 立即执行:

1. **选择是否修改代码支持环境变量**
   - 如果是,我需要修改 `server.js` 的 `loadConfig()` 函数
   - 如果否,在 Vercel 部署时需手动上传 `config.yaml`(不推荐)

2. **推送到 GitHub**
   ```bash
   git add .
   git commit -m "v3.0.4: 准备部署到 Vercel"
   git push
   ```

3. **在 Vercel 配置环境变量**
   - 至少需要: `DEEPSEEK_API_KEY`, `WEIXIN_APP_ID`, `WEIXIN_APP_SECRET`

### 可选优化:

1. 添加日志记录(方便 Vercel 排查问题)
2. 添加错误处理和重试机制
3. 添加访问量统计
4. 添加用户认证(防止滥用)

---

## 🎯 快速决策

请选择:

**A. 修改代码支持环境变量** (推荐)
- 我会修改 `server.js`,使其优先读取环境变量
- 部署后只需配置环境变量即可运行
- 本地开发仍可使用 `config.yaml`

**B. 不修改代码,直接部署**
- 需要在 Vercel 手动上传 `config.yaml`
- 不推荐,因为配置文件会暴露在服务器上

**C. 使用其他平台部署**
- Render.com: 免费,支持持久化存储
- Railway.app: 完整的 Node.js 支持
- 国内云服务器: 需要付费,但国内访问快

---

**请告诉我你的选择,我会继续协助完成部署!**
