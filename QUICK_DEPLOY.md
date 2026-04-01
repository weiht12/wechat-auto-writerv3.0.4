# Vercel 快速部署指南 (5分钟完成)

## 📦 前置条件

- ✅ 已安装 Git
- ✅ 已有 GitHub 账号
- ✅ 已有 Vercel 账号(用 GitHub 登录)
- ✅ 已准备好以下 API 密钥:
  - DeepSeek API Key
  - 微信公众号 AppID + AppSecret

---

## ⚡ 步骤 1: 推送代码到 GitHub (2分钟)

```powershell
# 进入项目目录
cd c:/Users/Administrator/WorkBuddy/20260312163133/wechat-auto-writer

# 初始化 Git
git init

# 添加所有文件
git add .

# 提交
git commit -m "v3.0.4: 准备部署到 Vercel"

# 创建 GitHub 仓库并推送(需要先安装 GitHub CLI: gh)
gh repo create wechat-auto-writer --public --source=. --remote=origin --push

# 如果没有安装 gh,手动执行:
# git remote add origin https://github.com/YOUR_USERNAME/wechat-auto-writer.git
# git branch -M main
# git push -u origin main
```

---

## ⚡ 步骤 2: 在 Vercel 创建项目 (2分钟)

1. **登录 Vercel**
   - 访问 [vercel.com](https://vercel.com)
   - 点击 "Continue with GitHub"

2. **导入项目**
   - 点击 "Add New" → "Project"
   - 选择刚创建的 `wechat-auto-writer` 仓库
   - 点击 "Import"

3. **配置项目**
   - **Framework Preset**: `Other`
   - **Root Directory**: (留空)
   - **Build Command**: (留空)
   - **Output Directory**: (留空)
   - **Install Command**: `npm install`

   点击 "Next"

---

## ⚡ 步骤 3: 配置环境变量 (1分钟)

在 **Environment Variables** 部分添加:

| Key | Value |
|-----|-------|
| `DEEPSEEK_API_KEY` | 你的 DeepSeek API Key |
| `WEIXIN_APP_ID` | 你的微信 AppID |
| `WEIXIN_APP_SECRET` | 你的微信 AppSecret |

**其他可选变量** (如果需要):
| Key | Value |
|-----|-------|
| `SILICONFLOW_API_KEY` | SiliconFlow API Key (AI配图) |
| `TAVILY_API_KEY` | Tavily API Key (全网搜索) |

⚠️ **重要**: 选择 **All** 环境(Production, Preview, Development)

---

## ⚡ 步骤 4: 开始部署 (30秒)

点击 **"Deploy"** 按钮

等待部署完成(约 1-2 分钟)

---

## ✅ 部署完成!

访问 Vercel 提供的域名,例如:
```
https://wechat-auto-writer.vercel.app
```

---

## 🧪 测试功能

1. **访问首页** → 页面正常显示
2. **点击"每日热点"** → 应该能看到热点新闻
3. **点击"生成文章"** → 选择热点,生成文章
4. **测试微信推送** → 需要配置正确的 AppID/AppSecret

---

## 🔄 更新部署

代码修改后,推送到 GitHub 会自动触发部署:

```bash
git add .
git commit -m "更新描述"
git push
```

---

## 🐛 常见问题

### Q1: 部署失败: "Module not found"

**A**: 检查 `package.json` 的 `dependencies` 是否完整

### Q2: API 超时

**A**: Vercel 免费版限制 60 秒,已使用 SSE 流式推送缓解

### Q3: 环境变量不生效

**A**: 添加环境变量后,点击 **Redeploy** 按钮

### Q4: 微信推送失败

**A**: 检查 AppID/AppSecret 是否正确,公众号是否已认证

---

## 📞 需要帮助?

- 查看 [DEPLOY_TO_VERCEL.md](DEPLOY_TO_VERCEL.md) 详细文档
- 查看 [ENV_VARIABLES.md](ENV_VARIABLES.md) 环境变量说明
- 查看 [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) 检查清单

---

## 🎉 完成!

现在你的公众号写作助手已经可以公开访问了!
