# Vercel 部署指南

## 📋 部署前准备

### 1. 检查 `.gitignore` 文件

确保以下敏感文件不会被提交到 Git:

```
config.yaml
.env
data/
output/
```

✅ 已配置 - 项目根目录已有 `.gitignore` 文件

---

## 🚀 部署步骤

### 步骤 1: 推送代码到 GitHub

```powershell
cd c:/Users/Administrator/WorkBuddy/20260312163133/wechat-auto-writer

# 初始化 Git 仓库
git init

# 添加所有文件
git add .

# 提交代码
git commit -m "v3.0.4: 部署到 Vercel"

# 创建 GitHub 仓库(需要先安装 GitHub CLI: gh)
gh repo create wechat-auto-writer --public --source=. --remote=origin --push

# 或手动推送到已有仓库:
# git remote add origin https://github.com/YOUR_USERNAME/wechat-auto-writer.git
# git branch -M main
# git push -u origin main
```

### 步骤 2: 在 Vercel 创建项目

1. 访问 [vercel.com](https://vercel.com),使用 GitHub 账号登录
2. 点击 **"New Project"**
3. 选择刚创建的 `wechat-auto-writer` 仓库
4. 点击 **"Import"**

### 步骤 3: 配置环境变量

在 **Environment Variables** 部分添加以下变量:

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `DEEPSEEK_API_KEY` | ✅ | DeepSeek API 密钥 |
| `SILICONFLOW_API_KEY` | ✅ | SiliconFlow API 密钥 |
| `WEIXIN_APP_ID` | ✅ | 微信公众号 AppID |
| `WEIXIN_APP_SECRET` | ✅ | 微信公众号 AppSecret |
| `TAVILY_API_KEY` | ⭕ | Tavily 搜索 API(可选) |

**获取方式**:

1. **DeepSeek API**: [https://platform.deepseek.com/](https://platform.deepseek.com/) 注册并创建 API Key
2. **SiliconFlow API**: [https://siliconflow.cn/](https://siliconflow.cn/) 注册并创建 API Key
3. **微信公众号**: 登录 [mp.weixin.qq.com](https://mp.weixin.qq.com/) → 开发 → 基本配置
4. **Tavily API**: [https://api.tavily.com/](https://api.tavily.com/) 注册(全网搜索功能)

### 步骤 4: 部署设置

**Build Settings**:

- **Framework Preset**: `Other`
- **Build Command**: (留空)
- **Output Directory**: (留空)
- **Install Command**: `npm install`

**Root Directory**: (留空)

**Environment**: 选择 `Production`

### 步骤 5: 开始部署

点击 **"Deploy"** 按钮,Vercel 会自动:
1. 安装依赖
2. 启动服务器
3. 分配 HTTPS 域名

部署完成后,你会得到一个类似 `https://wechat-auto-writer.vercel.app` 的访问地址。

---

## ⚙️ Vercel 配置说明

项目根目录的 `vercel.json` 配置:

```json
{
  "version": 2,
  "builds": [
    {
      "src": "server.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "/server.js"
    }
  ],
  "functions": {
    "server.js": {
      "maxDuration": 60
    }
  }
}
```

- **maxDuration: 60**: 函数最大执行时间 60 秒(Vercel 免费版限制)
- **routes**: 所有请求都转发到 `server.js`

---

## ⚠️ Vercel 免费版限制

1. **执行时间**: Serverless Functions 最长 60 秒
   - 影响: AI 生成文章、抓取热点等耗时操作可能超时
   - 解决: 使用 SSE 流式推送(已实现)或升级付费版

2. **并发请求**: 100 并发/月
   - 影响: 高并发时会受限

3. **存储**: 无持久化存储
   - 影响: `data/` 和 `output/` 目录无法持久保存
   - 解决: 改用云数据库(Vercel Postgres)或外部存储

---

## 🔄 更新部署

代码更新后,推送到 GitHub,Vercel 会自动重新部署:

```bash
git add .
git commit -m "描述更新内容"
git push
```

---

## 🌐 自定义域名

在 Vercel 项目设置中,可以绑定自定义域名:

1. Settings → Domains
2. 添加你的域名(如 `writer.yourdomain.com`)
3. 按照提示配置 DNS 记录

---

## 📊 监控日志

在 Vercel 项目控制台查看:
- **Logs**: 实时日志
- **Analytics**: 访问统计
- **Usage**: 资源使用情况

---

## 🐛 常见问题

### 1. 部署失败: Module not found

**原因**: 依赖未正确安装

**解决**:
- 检查 `package.json` 中 `dependencies` 是否完整
- 确保使用 `npm install` 而非 `pnpm` 或 `yarn`

### 2. API 超时错误

**原因**: Vercel 免费版 60 秒限制

**解决**:
- 已使用 SSE 流式推送,减少超时风险
- 或升级到 Vercel Pro 计划($20/月)

### 3. 环境变量未生效

**原因**: 部署后环境变量才生效

**解决**:
- 添加环境变量后点击 **"Redeploy"**
- 或推送新代码触发重新部署

### 4. 静态文件 404

**原因**: `vercel.json` 路由配置问题

**解决**:
- 确保路由规则正确: `"src": "/(.*)", "dest": "/server.js"`
- 检查 `public/` 目录是否存在

---

## 🔒 安全最佳实践

1. ✅ 敏感信息已通过 `.gitignore` 排除
2. ✅ 使用环境变量存储密钥
3. ⚠️ 微信公众号 AppSecret 等信息请勿公开分享
4. ⚠️ 生产环境建议启用 Vercel 的访问控制

---

## 📝 服务器端代码需要修改的注意事项

**当前代码读取 config.yaml,需要改为读取环境变量**:

```javascript
// 修改前 (server.js 第 22-25 行)
function loadConfig() {
  const configPath = path.join(__dirname, 'config.yaml');
  return yaml.load(fs.readFileSync(configPath, 'utf8'));
}

// 修改后(支持环境变量)
function loadConfig() {
  try {
    const configPath = path.join(__dirname, 'config.yaml');
    return yaml.load(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    // 降级到环境变量
    return {
      ai: {
        provider: process.env.AI_PROVIDER || 'deepseek',
        deepseek: {
          api_key: process.env.DEEPSEEK_API_KEY,
          api_base: process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com/v1',
          model: 'deepseek-chat',
          temperature: 0.8,
          max_tokens: 8000
        },
        // ... 其他配置
      },
      weixin: {
        enabled: true,
        app_id: process.env.WEIXIN_APP_ID,
        app_secret: process.env.WEIXIN_APP_SECRET,
        // ... 其他配置
      },
      // ... 其他配置
    };
  }
}
```

⚠️ **重要**: 如果要完全基于环境变量,需要重构 `loadConfig()` 函数。

---

## 🎉 部署完成后

1. 访问 Vercel 提供的 HTTPS 域名
2. 测试核心功能:
   - ✅ 仪表盘加载
   - ✅ 热点抓取
   - ✅ AI 生成文章
   - ✅ 微信推送

3. 分享给朋友使用

---

## 💡 备选方案

如果 Vercel 的限制影响使用,可以考虑:

- **Render.com**: 免费额度更大,支持持久化存储
- **Railway.app**: 完整的 Node.js 支持
- **阿里云/腾讯云**: 国内访问速度更快

---

## 📞 支持

如有问题,请:
1. 查看 Vercel 官方文档: [vercel.com/docs](https://vercel.com/docs)
2. 检查项目 GitHub Issues
3. 提交 Issue 描述问题
