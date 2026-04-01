# 微信公众号自动写作助手

一个基于 Node.js 的微信公众号自动化写作工具,支持 AI 生成文章、风格档案分析、热点监控等功能。

## ✨ 核心功能

- 📝 **AI 智能生成** - 基于 DeepSeek/通义千问等模型生成高质量文章
- 🎨 **风格档案** - 分析历史文章,建立写作风格模型
- 🔥 **每日热点** - 自动抓取河南地区热点新闻
- 📊 **数据仪表盘** - 可视化展示文章库和分析结果
- 📱 **微信推送** - 一键推送文章到微信公众号草稿箱
- 🖼️ **AI 配图** - 自动生成文章配图
- 🔍 **参考仿写** - 基于参考文章仿写内容

## 🚀 快速开始

### 本地运行

```bash
# 安装依赖
npm install

# 复制配置文件
cp config.example.yaml config.yaml

# 编辑 config.yaml,填入你的 API 密钥
# - DeepSeek API Key
# - 微信公众号 AppID/AppSecret
# - Tavily API Key (可选)

# 启动服务
npm start
# 或
node server.js
```

访问 http://localhost:3000

### 部署到 Vercel

#### 1. 环境变量配置

在 Vercel 项目的 Settings → Environment Variables 中添加:

| 变量名 | 说明 | 获取方式 |
|--------|------|----------|
| `DEEPSEEK_API_KEY` | DeepSeek AI 密钥 | [https://platform.deepseek.com/](https://platform.deepseek.com/) |
| `SILICONFLOW_API_KEY` | SiliconFlow API 密钥 | [https://siliconflow.cn/](https://siliconflow.cn/) |
| `TAVILY_API_KEY` | Tavily 搜索密钥 | [https://api.tavily.com/](https://api.tavily.com/) |
| `WEIXIN_APP_ID` | 微信公众号 AppID | 微信公众平台后台 |
| `WEIXIN_APP_SECRET` | 微信公众号 AppSecret | 微信公众平台后台 |

#### 2. 一键部署

点击下方按钮一键部署到 Vercel:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/yourusername/wechat-auto-writer)

#### 3. 手动部署步骤

```bash
# 1. Fork 本仓库到你的 GitHub 账号
# 2. 在 Vercel 中创建新项目,选择刚 Fork 的仓库
# 3. 配置环境变量
# 4. 点击 Deploy
```

## 📁 项目结构

```
wechat-auto-writer/
├── server.js              # Express 服务器入口
├── config.yaml            # 配置文件(已忽略,使用 config.example.yaml)
├── public/                # 前端静态文件
│   ├── index.html         # 主页面
│   ├── app-new.js         # 前端逻辑
│   └── style.css          # 样式文件
├── src/                   # 核心模块
│   ├── scraper.js         # 新闻抓取
│   ├── rewriter.js        # AI 改写
│   ├── formatter.js       # Markdown 格式化
│   ├── publisher.js       # 微信推送
│   ├── history-sync.js    # 历史同步
│   ├── style-analyzer.js  # 风格分析
│   └── hot-topics.js      # 热点监控
├── data/                  # 数据目录
└── output/                # 输出目录
```

## 🔧 配置说明

详细配置说明请参考 [config.example.yaml](config.example.yaml)

## 📝 API 接口

### GET /api/status
获取仪表盘数据(风格档案、文章库状态)

### GET /api/hot-topics
获取每日热点(SSE 流式推送)

### POST /api/generate
AI 生成文章

### POST /api/push-draft
推送文章到微信公众号

### GET /api/config/key-status
检查 API Key 配置状态

完整 API 文档请查看 [server.js](server.js)

## 🔐 安全说明

- 本项目已配置 `.gitignore`,敏感配置文件不会被提交到 Git
- 部署时请使用环境变量存储密钥,不要硬编码
- 微信公众号 AppSecret 等敏感信息请妥善保管

## 📄 License

MIT

## 🙏 致谢

- [DeepSeek](https://www.deepseek.com/) - AI 模型支持
- [Vercel](https://vercel.com/) - 部署平台
- [Express](https://expressjs.com/) - Web 框架
