'use strict';

/**
 * 公众号自动化写作工具 - Web 服务端
 * 将所有 CLI 功能封装为 REST API，供前端页面调用
 */

const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const yaml       = require('js-yaml');

const NewsScraper      = require('./src/scraper');
const AIRewriter       = require('./src/rewriter');
const MarkdownFormatter = require('./src/formatter');
const WeixinPublisher  = require('./src/publisher');
const HistorySync      = require('./src/history-sync');
const StyleAnalyzer    = require('./src/style-analyzer');
const HotTopics        = require('./src/hot-topics');

// ─── 加载配置 ────────────────────────────────────────────────
// 优先从环境变量读取,失败时降级到 config.yaml
function loadConfig() {
  // 优先尝试从环境变量加载(用于 Vercel 等平台)
  if (process.env.DEEPSEEK_API_KEY || process.env.SILICONFLOW_API_KEY || process.env.WEIXIN_APP_ID) {
    console.log('[Config] 从环境变量加载配置');
    return {
      ai: {
        provider: process.env.AI_PROVIDER || 'deepseek',
        deepseek: {
          api_key: process.env.DEEPSEEK_API_KEY,
          api_base: process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com/v1',
          model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
          temperature: parseFloat(process.env.DEEPSEEK_TEMPERATURE || '0.8'),
          max_tokens: parseInt(process.env.DEEPSEEK_MAX_TOKENS || '8000')
        },
        tongyi: {
          api_key: process.env.TONGYI_API_KEY,
          api_base: process.env.TONGYI_API_BASE || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          model: process.env.TONGYI_MODEL || 'qwen-turbo',
          temperature: parseFloat(process.env.TONGYI_TEMPERATURE || '0.8'),
          max_tokens: parseInt(process.env.TONGYI_MAX_TOKENS || '8000')
        },
        wenxin: {
          api_key: process.env.WENXIN_API_KEY,
          secret_key: process.env.WENXIN_SECRET_KEY,
          model: process.env.WENXIN_MODEL || 'ernie-bot-4',
          temperature: parseFloat(process.env.WENXIN_TEMPERATURE || '0.8'),
          max_tokens: parseInt(process.env.WENXIN_MAX_TOKENS || '4000')
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
      },
      output: {
        directory: process.env.OUTPUT_DIRECTORY || './output',
        filename_format: process.env.OUTPUT_FILENAME_FORMAT || 'datetime',
        save_raw: process.env.OUTPUT_SAVE_RAW !== 'false'
      },
      weixin: {
        enabled: process.env.WEIXIN_ENABLED !== 'false',
        app_id: process.env.WEIXIN_APP_ID,
        app_secret: process.env.WEIXIN_APP_SECRET,
        author: process.env.WEIXIN_AUTHOR || '公众号',
        default_thumb_media_id: process.env.WEIXIN_DEFAULT_THUMB_MEDIA_ID || '',
        open_comment: process.env.WEIXIN_OPEN_COMMENT !== 'false',
        publish_directly: process.env.WEIXIN_PUBLISH_DIRECTLY === 'true'
      },
      ima: {
        client_id: process.env.IMA_CLIENT_ID,
        client_secret: process.env.IMA_CLIENT_SECRET
      }
    };
  }

  // 降级到 config.yaml
  const configPath = path.join(__dirname, 'config.yaml');
  if (fs.existsSync(configPath)) {
    console.log('[Config] 从 config.yaml 加载配置');
    return yaml.load(fs.readFileSync(configPath, 'utf8'));
  }

  throw new Error('配置文件 config.yaml 不存在且环境变量未设置');
}

const app = express();
// 解决风格档案分析时的 413 错误：文章太长，增大 limit 到 50MB
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ─── 动态注入实时时间戳，彻底绕过浏览器硬缓存 ────────────────
app.get('/', (req, res) => {
  const ts = Date.now();
  const htmlPath = path.join(__dirname, 'public', 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  // 替换版本戳为实时时间戳
  html = html.replace(/\?v=[\w]+/g, `?v=${ts}`);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(html);
});

app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  },
}));

// ─── SSE 工具：流式推送进度 ──────────────────────────────────
function sseSetup(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
}

function sseSend(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sseDone(res, data) {
  res.write(`data: ${JSON.stringify({ ...data, __done: true })}\n\n`);
  res.end();
}

function sseError(res, msg) {
  res.write(`data: ${JSON.stringify({ error: msg, __done: true })}\n\n`);
  res.end();
}

// ═══════════════════════════════════════════════════════════════
// GET /api/status  —— 仪表盘：风格档案 + 文章库状态
// ═══════════════════════════════════════════════════════════════
app.get('/api/status', (req, res) => {
  try {
    const config        = loadConfig();
    const styleAnalyzer = new StyleAnalyzer(config);
    const historySync   = new HistorySync(config);
    const profile       = styleAnalyzer.loadProfile();
    const localDb       = historySync.loadLocal();

    // 统计已生成文章
    const outputDir = path.join(__dirname, 'output');
    let outputFiles = [];
    if (fs.existsSync(outputDir)) {
      outputFiles = fs.readdirSync(outputDir)
        .filter(f => f.endsWith('.md') || f.endsWith('.html'))
        .sort()
        .reverse()
        .slice(0, 20)
        .map(f => {
          const fp  = path.join(outputDir, f);
          const raw = fs.readFileSync(fp, 'utf8');
          // 从 Markdown 中提取标题行
          const titleMatch = raw.match(/^#\s+(.+)/m);
          const title = titleMatch ? titleMatch[1].trim() : f.replace(/\.[^.]+$/, '');
          const stat  = fs.statSync(fp);
          return { name: f, title, size: stat.size, mtime: stat.mtime.toISOString() };
        });
    }

    // 热点缓存状态
    const cachePath = path.join(__dirname, 'data', 'hot_topics_cache.json');
    let hotCache = null;
    if (fs.existsSync(cachePath)) {
      try {
        const c = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        const today = new Date().toISOString().substring(0, 10);
        if (c.date === today) hotCache = { count: c.topics.length, generated_at: c.generated_at };
      } catch(e) {}
    }

    res.json({
      profile: profile ? {
        summary:      profile.summary,
        analyzed_at:  profile._meta?.analyzed_at,
        sample_count: profile._meta?.sample_count,
        tone_keywords: profile.tone?.keywords,
        themes:        profile.content?.themes,
      } : null,
      articles: localDb ? { total: localDb.total, synced_at: localDb.synced_at } : null,
      output:   outputFiles,
      hotCache,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/profile  —— 完整风格档案
// ═══════════════════════════════════════════════════════════════
app.get('/api/profile', (req, res) => {
  try {
    const config        = loadConfig();
    const styleAnalyzer = new StyleAnalyzer(config);
    const profile       = styleAnalyzer.loadProfile();
    if (!profile) return res.status(404).json({ error: '尚未建立风格档案' });
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/hot-topics  —— 每日河南热点（SSE 流式）
// ═══════════════════════════════════════════════════════════════
app.get('/api/hot-topics', async (req, res) => {
  sseSetup(res);
  const refresh = req.query.refresh === '1';
  // 自定义消息源：JSON 字符串 [{name, url, selector}]
  let customSources = [];
  try {
    if (req.query.custom) customSources = JSON.parse(req.query.custom);
  } catch(e) {}

  try {
    const config    = loadConfig();
    const hotTopics = new HotTopics(config);

    // 检查缓存（自定义消息源时跳过缓存）
    if (!refresh && !customSources.length) {
      const cached = hotTopics._loadCache();
      if (cached) {
        sseSend(res, { type: 'cached', generated_at: cached.generated_at, site_stats: cached.site_stats });
        sseDone(res, { type: 'topics', topics: cached.topics, site_stats: cached.site_stats });
        return;
      }
    } else {
      const cachePath = path.join(__dirname, 'data', 'hot_topics_cache.json');
      try { fs.unlinkSync(cachePath); } catch(e) {}
    }

    // 直接调用内部方法（不走 inquirer 交互）
    sseSend(res, { type: 'progress', msg: '正在从大河财立方、河南省政府、百度新闻同步抓取...' });

    // 动态引入抓取函数（模块内部未导出，通过 eval 不优雅，改为重新实现调度）
    const _axios   = require('axios');
    const axios    = _axios.default || _axios;
    const cheerio  = require('cheerio');

    const agent = (() => {
      try { const https = require('https'); return new https.Agent({ rejectUnauthorized: false }); }
      catch(e) { return undefined; }
    })();

    async function httpGet(url, headers = {}) {
      return axios({ method: 'get', url, timeout: 12000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept-Language': 'zh-CN,zh;q=0.9', ...headers },
        httpsAgent: agent, maxRedirects: 5,
      });
    }

    async function httpPost(url, data) {
      return axios({ method: 'post', url, data: JSON.stringify(data), timeout: 12000,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/json',
          'Referer': 'https://www.dahecube.com/', 'Origin': 'https://www.dahecube.com' },
        httpsAgent: agent,
      });
    }

    const [r1, r2, r3] = await Promise.allSettled([
      // 大河财立方
      (async () => {
        const arts = [];
        for (const cid of [1, 2]) {
          try {
            const r = await httpPost('https://app.dahecube.com/napi/news/pc/list', { channelid: cid, pno: 1, psize: 15 });
            for (const it of (r.data?.data?.items || [])) {
              if (it.title) arts.push({ title: it.title, url: it.linkurl || `https://www.dahecube.com/article.html?artid=${it.recid}`, time: it.pubtime||'', source: '大河财立方' });
            }
          } catch(e) {}
        }
        return arts;
      })(),
      // 河南省政府
      (async () => {
        const arts = []; const seen = new Set();
        try {
          const r = await httpGet('https://www.henan.gov.cn/', { Referer: 'https://www.henan.gov.cn/' });
          const $ = cheerio.load(r.data);
          $('li.dh_modular_news a, h3 a, h4 a').each((_, el) => {
            const t = $(el).text().trim().replace(/\s+/g, ' ');
            let h = $(el).attr('href') || '';
            if (!h.startsWith('http')) h = 'https://www.henan.gov.cn' + h;
            if (t.length >= 8 && t.length <= 80 && !seen.has(t)) { seen.add(t); arts.push({ title: t, url: h, time: '', source: '河南省政府' }); }
          });
        } catch(e) {}
        return arts;
      })(),
      // 百度新闻
      (async () => {
        const arts = []; const seen = new Set();
        const kws = ['河南发展','郑州规划','河南高铁','河南机场','河南工程项目','河南城市','河南经济','河南基础设施'];
        for (const kw of kws) {
          try {
            const url = `https://news.baidu.com/ns?word=${encodeURIComponent(kw)}&tn=news&from=news&cl=2&pn=0&rn=20&ct=1`;
            const r = await httpGet(url, { Referer: 'https://news.baidu.com/' });
            const $ = cheerio.load(r.data);
            $('a').each((_, el) => {
              const t = $(el).text().trim().replace(/\s+/g, ' ');
              const h = $(el).attr('href') || '';
              if (t.length>=10 && t.length<=80 && h.startsWith('http') && !seen.has(t) && !t.includes('广告')) {
                seen.add(t); arts.push({ title: t, url: h, time: '', source: `百度新闻·${kw}` });
              }
              if (arts.filter(a=>a.source.includes(kw)).length >= 6) return false;
            });
            await new Promise(r => setTimeout(r, 350));
          } catch(e) {}
        }
        return arts;
      })(),
    ]);

    const labels = ['大河财立方', '河南省政府', '百度新闻'];
    const siteStats = {};
    let allArticles = [];
    [r1, r2, r3].forEach((r, i) => {
      if (r.status === 'fulfilled') { siteStats[labels[i]] = r.value.length; allArticles = allArticles.concat(r.value); }
      else siteStats[labels[i]] = 0;
    });

    // 抓取自定义消息源
    if (customSources.length > 0) {
      sseSend(res, { type: 'progress', msg: `正在抓取 ${customSources.length} 个自定义消息源...` });
      for (const src of customSources) {
        try {
          const r = await httpGet(src.url, { Referer: src.url });
          const $c = cheerio.load(r.data);
          const seen = new Set();
          const arts = [];
          const selector = src.selector || 'a';
          $c(selector).each((_, el) => {
            const t = $c(el).text().trim().replace(/\s+/g, ' ');
            let h = $c(el).attr('href') || '';
            if (!h.startsWith('http')) {
              try {
                const base = new URL(src.url);
                h = base.origin + (h.startsWith('/') ? h : '/' + h);
              } catch(e) {}
            }
            if (t.length >= 8 && t.length <= 120 && !seen.has(t)) {
              seen.add(t);
              arts.push({ title: t, url: h, time: '', source: src.name });
            }
            if (arts.length >= 20) return false;
          });
          siteStats[src.name] = arts.length;
          allArticles = allArticles.concat(arts);
        } catch(e) {
          siteStats[src.name] = 0;
        }
      }
    }

    sseSend(res, { type: 'stats', site_stats: siteStats, total: allArticles.length });

    if (allArticles.length === 0) {
      sseError(res, '所有数据源均抓取失败，请检查网络后重试');
      return;
    }

    sseSend(res, { type: 'progress', msg: `AI 正在从 ${allArticles.length} 条资讯中提炼 10 个热点话题...` });

    // AI 提炼（复用内部函数）
    const { OpenAI } = require('openai');
    const cfg = config.ai[config.ai.provider] || {};
    const ai  = new OpenAI({ apiKey: cfg.api_key || '', baseURL: cfg.api_base || 'https://api.deepseek.com/v1' });
    const model = cfg.model || 'deepseek-chat';

    const grouped = {};
    for (const a of allArticles) {
      const src = a.source.includes('大河财立方') ? '大河财立方' : a.source.includes('河南省政府') ? '河南省政府' : '百度新闻';
      if (!grouped[src]) grouped[src] = [];
      grouped[src].push(a.title);
    }
    const titlesText = Object.entries(grouped).map(([s, ts]) => `【${s}】\n${ts.slice(0, 20).map((t,i) => `${i+1}. ${t}`).join('\n')}`).join('\n\n');
    const styleHint = `堂主的选题偏好：\n- 核心主题：河南区域发展规划、城市竞争比较、交通基础设施（高铁/机场/城际）\n- 关注点：国企动态、工业产业、政策落地、城市排名数据\n- 风格：犀利直白、善用数据、有地域情感、挖掘争议性角度`;
    const prompt = `以下是今日从三个来源抓取的河南最新资讯：\n\n${titlesText}\n\n${styleHint}\n\n请从中筛选出最值得"堂主"写成公众号文章的 10 个热点话题。\n要求：\n1. 优先选择有数据、有争议、有地域对比的内容\n2. 每个话题给一个具体"选题角度"（30字内）\n3. 注明原始来源\n\n格式（严格按此输出，共10行，每行用|分隔）：\n序号|话题标题|选题角度|来源\n\n只输出10行，不要其他任何内容。`;

    const resp = await ai.chat.completions.create({
      model, temperature: 0.5,
      messages: [
        { role: 'system', content: '你是专注河南地区的公众号选题编辑，熟悉本地读者关注点。' },
        { role: 'user',   content: prompt },
      ],
    });

    const raw = resp.choices[0].message.content.trim();
    const topics = [];
    for (const line of raw.split('\n')) {
      const parts = line.split('|');
      if (parts.length < 3) continue;
      const no  = parts[0].trim().replace(/[^\d]/g, '');
      const title  = (parts[1] || '').trim();
      const angle  = (parts[2] || '').trim();
      const source = (parts[3] || '').trim();
      if (no && title) topics.push({ no: parseInt(no, 10) || topics.length + 1, title, angle, source });
    }
    const finalTopics = topics.slice(0, 10);

    // 缓存
    hotTopics._saveCache(finalTopics, siteStats);

    sseDone(res, { type: 'topics', topics: finalTopics, site_stats: siteStats });
  } catch (err) {
    sseError(res, err.message);
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/hot-topics-search  —— 本地热点关键词搜索（SSE 流式）
// ═══════════════════════════════════════════════════════════════
app.get('/api/hot-topics-search', async (req, res) => {
  sseSetup(res);
  const keyword = (req.query.keyword || '').trim();

  if (!keyword) {
    sseError(res, '请输入搜索关键词');
    return;
  }

  try {
    const config = loadConfig();
    const _axios  = require('axios');
    const axios   = _axios.default || _axios;
    const cheerio = require('cheerio');

    const agent = (() => {
      try { const https = require('https'); return new https.Agent({ rejectUnauthorized: false }); }
      catch(e) { return undefined; }
    })();

    async function httpGet(url, headers = {}) {
      return axios({ method: 'get', url, timeout: 12000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept-Language': 'zh-CN,zh;q=0.9', ...headers },
        httpsAgent: agent, maxRedirects: 5,
      });
    }

    sseSend(res, { type: 'progress', msg: `正在搜索「${keyword}」相关新闻...` });

    // 百度新闻多页搜索
    const allArticles = [];
    const seen = new Set();
    const siteStats = { '百度新闻': 0, '头条': 0, 'Google': 0 };

    // 百度新闻（减少页数，加快速度）
    for (let pn = 0; pn <= 20; pn += 10) {
      try {
        const url = `https://news.baidu.com/ns?word=${encodeURIComponent(keyword)}&tn=news&from=news&cl=2&pn=${pn}&rn=20&ct=1`;
        const r = await httpGet(url, { Referer: 'https://news.baidu.com/' });
        const $ = cheerio.load(r.data);

        $('a').each((_, el) => {
          const t = $(el).text().trim().replace(/\s+/g, ' ');
          const h = $(el).attr('href') || '';
          if (t.length >= 10 && t.length <= 100 && h.startsWith('http') && !seen.has(t) && !t.includes('广告')) {
            seen.add(t);
            allArticles.push({ title: t, url: h, source: `百度新闻·${keyword}` });
            siteStats['百度新闻']++;
          }
        });

        await new Promise(r => setTimeout(r, 300));
      } catch(e) {
        console.error(`[百度搜索] 第 ${pn} 页抓取失败:`, e.message);
      }
    }

    // 必应新闻（新增，替代头条，更稳定）
    try {
      const url = `https://www.bing.com/news/search?q=${encodeURIComponent(keyword)}&setlang=zh-CN`;
      const r = await httpGet(url, { Referer: 'https://www.bing.com/' });
      const $ = cheerio.load(r.data);
      $('a[href*="article"]').each((_, el) => {
        const t = $(el).text().trim().replace(/\s+/g, ' ');
        const h = $(el).attr('href') || '';
        if (t.length >= 10 && t.length <= 100 && !seen.has(t)) {
          seen.add(t);
          allArticles.push({ title: t, url: h, source: `必应·${keyword}` });
          siteStats['头条']++;
        }
      });
    } catch(e) {
      console.error(`[必应搜索] 抓取失败:`, e.message);
    }

    // Google Custom Search（如果配置了）
    const googleConfig = config.google || {};
    if (googleConfig.api_key && googleConfig.search_engine_id) {
      try {
        const googleUrl = `https://www.googleapis.com/customsearch/v1?key=${googleConfig.api_key}&cx=${googleConfig.search_engine_id}&q=${encodeURIComponent(keyword)}&num=10`;
        const r = await httpGet(googleUrl);
        const items = r.data?.items || [];

        for (const item of items) {
          const t = item.title?.trim() || '';
          const h = item.link || '';
          if (t.length >= 10 && t.length <= 120 && h && !seen.has(t)) {
            seen.add(t);
            allArticles.push({ title: t, url: h, source: `Google·${keyword}` });
            siteStats['Google']++;
          }
        }
      } catch(e) {
        console.error(`[Google搜索] 抓取失败:`, e.message);
      }
    }

    sseSend(res, { type: 'stats', site_stats: siteStats, total: allArticles.length });
    sseSend(res, { type: 'progress', msg: `共找到 ${allArticles.length} 条相关资讯，AI 正在提炼选题...` });

    if (allArticles.length === 0) {
      sseError(res, `未找到「${keyword}」的相关内容，请换个关键词试试`);
      return;
    }

    // AI 提炼选题
    const { OpenAI } = require('openai');
    const cfg = config.ai[config.ai.provider] || {};
    const ai  = new OpenAI({ apiKey: cfg.api_key || '', baseURL: cfg.api_base || 'https://api.deepseek.com/v1' });
    const model = cfg.model || 'deepseek-chat';

    const titlesText = allArticles.slice(0, 30).map((a, i) => `${i + 1}. ${a.title}`).join('\n');
    const prompt = `以下是关于「${keyword}」的新闻资讯：\n\n${titlesText}\n\n请从中筛选出最值得写成公众号文章的 5 个话题。\n要求：\n1. 优先选择有数据、有争议、有深度的内容\n2. 每个话题给一个具体"选题角度"（30字内）\n3. 注明原始来源序号\n\n格式（严格按此输出，共5行，每行用|分隔）：\n序号|话题标题|选题角度|来源\n\n只输出5行，不要其他任何内容。`;

    const resp = await ai.chat.completions.create({
      model, temperature: 0.5,
      messages: [
        { role: 'system', content: '你是专业的公众号选题编辑，善于从新闻中发现有价值的写作角度。' },
        { role: 'user',   content: prompt },
      ],
    });

    const raw = resp.choices[0].message.content.trim();
    const topics = [];
    for (const line of raw.split('\n')) {
      const parts = line.split('|');
      if (parts.length < 3) continue;
      const no    = parts[0].trim().replace(/[^\d]/g, '');
      const title = (parts[1] || '').trim();
      const angle = (parts[2] || '').trim();
      const source = (parts[3] || '').trim();
      if (no && title) topics.push({ no: parseInt(no, 10) || topics.length + 1, title, angle, source, keyword });
    }

    sseDone(res, { type: 'search_topics', topics: topics.slice(0, 5), keyword });

  } catch (err) {
    sseError(res, err.message);
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/fetch-news  —— 抓取新闻列表
// ═══════════════════════════════════════════════════════════════
app.post('/api/fetch-news', async (req, res) => {
  const { keyword, count = 8, useTavily = false } = req.body;
  if (!keyword) return res.status(400).json({ error: '关键词不能为空' });

  try {
    const config  = loadConfig();
    const scraper = new NewsScraper({ ...config, scraper: { ...config.scraper, max_articles: count + 3 } });

    // 调用 NewsScraper.fetchNews，传入 useTavily 选项
    const articles = await scraper.fetchNews(keyword, null, { useTavily });
    res.json({ articles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/global-hot  —— 全网热点搜索（Tavily） v2.9.6
// ═══════════════════════════════════════════════════════════════
app.post('/api/global-hot', async (req, res) => {
  const { query = '', max_results } = req.body;
  const maxR = parseInt(max_results) || 10;

  try {
    const config = loadConfig();
    const scraper = new NewsScraper(config);

    if (!query) {
      // 默认搜索今日热点
      const today = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
      const articles = await scraper.fetchWithTavily(`${today} 热点新闻`, { maxResults: Math.max(maxR, 10) });
      res.json({ articles });
    } else {
      // 用户指定关键词
      const articles = await scraper.fetchWithTavily(query, { maxResults: Math.max(maxR, 10) });
      res.json({ articles });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/write  —— 生成文章（SSE 流式）
// ═══════════════════════════════════════════════════════════════
app.post('/api/write', async (req, res) => {
  sseSetup(res);
  const {
    keyword,
    selectedIndexes = [],
    articles: clientArticles,
    writeMode = 'default',
    customDirection = '',
    customOutline = '',
    useStyleProfile = true,  // 默认启用风格档案，可由前端控制
    profileId = 'yushtang',  // v2.9.3 补丁：前端传来的风格档案 ID，默认豫事堂
    styleChip = '',          // v2.9.8+：智能路由用，如 'yushtang'/'depth'/'news'
  } = req.body;

  if (!keyword && (!clientArticles || clientArticles.length === 0)) {
    sseError(res, '缺少关键词或文章');
    return;
  }

  try {
    let config = loadConfig();

    // ── v2.9.8+ 自动 provider 路由 ──────────────────────────────
    // 若 siliconflow.api_key 有值，且当前 provider 不是 siliconflow，
    // 则自动将本次请求切换到 siliconflow，无需用户手动切换
    const sfKey = config.ai?.siliconflow?.api_key;
    const hasSfKey = sfKey && !sfKey.startsWith('YOUR_') && sfKey.length > 8;
    if (hasSfKey && config.ai?.provider !== 'siliconflow') {
      config = { ...config, ai: { ...config.ai, provider: 'siliconflow' } };
      console.log('  🔀 自动切换到硅基流动（已检测到 SF API Key）');
    }
    // ─────────────────────────────────────────────────────────────
    const styleAnalyzer = new StyleAnalyzer(config);
    const historySync   = new HistorySync(config);
    const rewriter      = new AIRewriter(config);

    // v2.9.3 补丁：按 profileId 从 PROFILES_DIR 读正确的风格档案
    // 不再无条件读旧的 data/style_profile.json（永远是豫事堂）
    ensureProfilesDir();
    let profile = null;
    if (useStyleProfile) {
      const profilePath = path.join(PROFILES_DIR, profileId + '.json');
      if (fs.existsSync(profilePath)) {
        try { profile = JSON.parse(fs.readFileSync(profilePath, 'utf8')); } catch(e) {}
      }
      // 兜底：若 profileId 对应文件不存在，再尝试老路径（yushtang 旧档案迁移前）
      if (!profile) {
        profile = styleAnalyzer.loadProfile();
      }
    }

    // 设置是否启用风格档案
    rewriter.setStyleProfileEnabled(useStyleProfile);

    let selectedArticles = clientArticles || [];
    const useDeepResearch = req.body.useDeepResearch === true;

    // Step 1：若没有传 articles，重新抓取
    if (selectedArticles.length === 0) {
      sseSend(res, { type: 'progress', step: 1, msg: `正在抓取「${keyword}」相关新闻...` });
      const scraper = new NewsScraper({ ...config, scraper: { ...config.scraper, max_articles: 8 } });
      const all = await scraper.fetchNews(keyword);
      selectedArticles = selectedIndexes.length > 0
        ? selectedIndexes.map(i => all[i]).filter(Boolean)
        : all.slice(0, 5);
    }

    sseSend(res, { type: 'progress', step: 1, msg: `已选 ${selectedArticles.length} 篇文章，开始AI改写...` });

    // Step 2：注入风格档案和自定义方向
    if (profile) {
      const referenceArticles = historySync.loadLocal()
        ? historySync.findSimilar(keyword || selectedArticles[0]?.title || '', 2)
        : [];
      const stylePrompt = styleAnalyzer.profileToPrompt(profile, referenceArticles);
      rewriter.setStylePrompt(stylePrompt);
    }


    // 注入用户自定义写作方向
    if (writeMode === 'custom') {
      rewriter.setCustomDirection({
        direction: customDirection,
        outline: customOutline,
      });
    }

    // 深度研究
    if (useDeepResearch) {
      sseSend(res, { type: 'progress', step: 2, msg: '正在进行深度研究，搜索相关资料...' });
      const topic = keyword || selectedArticles[0]?.title || '';
      const researchResult = await rewriter.conductDeepResearch(topic);
      if (researchResult) {
        rewriter.deepResearchResult = researchResult;
        sseSend(res, { type: 'progress', step: 2, msg: '深度研究完成，正在改写...' });
      }
    }


    // 进度提示（v2.9.3：动态显示档案名，不再硬编码）
    const profileDisplayName = profile?._profileName || profileId || '默认';
    if (writeMode === 'custom' && !useDeepResearch) {
      sseSend(res, { type: 'progress', step: 2, msg: '已应用自定义写作方向，AI正在按您的意图创作...' });
    } else if (useStyleProfile && profile && !useDeepResearch) {
      sseSend(res, { type: 'progress', step: 2, msg: `已加载「${profileDisplayName}」风格档案，AI正在模仿风格改写...` });
    } else if (!useDeepResearch) {
      sseSend(res, { type: 'progress', step: 2, msg: 'AI 正在改写文章(通用风格)...' });
    }


    // Step 3：AI 改写
    const result = await rewriter.mergeRewrite(selectedArticles, styleChip);
    sseSend(res, { type: 'progress', step: 3, msg: '改写完成，正在保存...' });

    // Step 4：保存 Markdown
    const formatter   = new MarkdownFormatter(config);
    const savedResults = formatter.saveAll([result]);
    const saved        = savedResults[0];

    // Step 5：推送微信（可选）
    const wxConfig  = config.weixin || {};
    const wxEnabled = wxConfig.enabled && wxConfig.app_id && !wxConfig.app_id.startsWith('YOUR_');
    let wxResult = null;

    if (wxEnabled) {
      sseSend(res, { type: 'progress', step: 4, msg: '正在推送到微信公众号草稿箱...' });
      try {
        const publisher = new WeixinPublisher(config);
        wxResult = await publisher.publish(result, { publishDirectly: wxConfig.publish_directly || false });
      } catch (e) {
        // v3.0.2 修复：捕获完整错误信息，包括 HTTP 状态码、响应数据和堆栈
        console.error('[微信推送] 错误详情:', {
          name: e.name,
          message: e.message,
          response: e.response ? {
            status: e.response.status,
            statusText: e.response.statusText,
            data: e.response.data
          } : null,
          request: e.request ? {
            url: e.request.url || e.request.path,
            method: e.request.method
          } : null,
          stack: e.stack
        });
        wxResult = { 
          error: e.message,
          details: e.response ? {
            status: e.response.status,
            data: e.response.data
          } : null
        };
      }
    }

    sseDone(res, {
      type:    'done',
      title:   result.title,
      summary: result.summary,
      content: result.content,
      tags:    result.tags,
      wordCount: result.content.replace(/\s/g, '').length,
      savedFile: saved?.success ? saved.filepath : null,
      mergedFrom: result.mergedFrom,
      wxResult,
    });

  } catch (err) {
    console.error('[API /api/write] 错误详情:', {
      message: err.message,
      stack: err.stack,
      name: err.name,
      response: err.response ? {
        status: err.response.status,
        data: err.response.data
      } : null,
      cause: err.cause ? err.cause.message : null
    });
    sseError(res, err.message);
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/output/:filename  —— 读取已生成文章
// ═══════════════════════════════════════════════════════════════
app.get('/api/output/:filename', (req, res) => {
  const fp = path.join(__dirname, 'output', req.params.filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: '文件不存在' });
  res.json({ content: fs.readFileSync(fp, 'utf8') });
});

// ═══════════════════════════════════════════════════════════════
// POST /api/analyze  —— 重新分析写作风格（SSE 流式）
// ═══════════════════════════════════════════════════════════════
app.post('/api/analyze', async (req, res) => {
  sseSetup(res);
  try {
    const config        = loadConfig();
    const historySync   = new HistorySync(config);
    const styleAnalyzer = new StyleAnalyzer(config);
    const samples       = historySync.getSamples(15);

    if (samples.length < 3) {
      sseError(res, `样本不足（当前 ${samples.length} 篇，至少需要 3 篇），请先导入文章`);
      return;
    }

    const profile = await styleAnalyzer.analyze(samples, (msg) => {
      sseSend(res, { type: 'progress', msg });
    });

    sseDone(res, { type: 'done', profile });
  } catch (err) {
    sseError(res, err.message);
  }
});



// ═══════════════════════════════════════════════════════════════
// POST /api/push-draft  —— 推送到微信公众号草稿箱（右侧预览按钮）
// ═══════════════════════════════════════════════════════════════
app.post('/api/push-draft', async (req, res) => {
  try {
    const { title, content } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: '标题和内容不能为空' });
    }

    const config = loadConfig();
    const wxConfig = config.weixin || {};
    const wxEnabled = wxConfig.enabled && wxConfig.app_id && !wxConfig.app_id.startsWith('YOUR_');

    if (!wxEnabled) {
      return res.status(400).json({ error: '微信公众号未配置或未启用' });
    }

    const publisher = new WeixinPublisher(config);
    const result = await publisher.publish(
      { title, content, summary: content.substring(0, 120) },
      { publishDirectly: false }
    );

    res.json({ success: true, mediaId: result.draftMediaId });
  } catch (err) {
    console.error('[api/push-draft] 错误:', err.message);
    res.status(500).json({ error: err.message });
  }
});








// ═══════════════════════════════════════════════════════════════
// GET /api/config  —— 读取部分配置（v2.9.5 安全加固：绝不返回 api_key 明文）
// 新增 sf_key_configured / ds_key_configured / ty_key_configured 布尔值
// 前端凭此判断"是否已配置"，展示掩码状态，不需要回传明文
// ═══════════════════════════════════════════════════════════════
app.get('/api/config', (req, res) => {
  try {
    const config = loadConfig();
    const ai = config.ai || {};
    function hasKey(cfg) { return !!(cfg?.api_key && !cfg.api_key.startsWith('YOUR_') && cfg.api_key.length > 8); }
    res.json({
      provider:            ai.provider,
      model:               ai[ai.provider]?.model,
      siliconflow_model:   ai.siliconflow?.model || 'deepseek-ai/DeepSeek-V3',  // v2.9.7
      style:               config.rewrite?.style,
      target_words:        config.rewrite?.target_words,
      wx_enabled:          !!(config.weixin?.enabled && config.weixin?.app_id && !config.weixin?.app_id.startsWith('YOUR_')),
      wx_author:           config.weixin?.author || '',
      sf_key_configured:   hasKey(ai.siliconflow),  // true/false，不含明文
      ds_key_configured:   hasKey(ai.deepseek),
      ty_key_configured:   hasKey(ai.tongyi),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════
// POST /api/config/provider  —— 切换 AI 提供商（v2.9.6 逐行替换）
// Body: { provider: 'deepseek' | 'tongyi' | 'siliconflow' }
// ═══════════════════════════════════════════════════════════════
app.post('/api/config/provider', (req, res) => {
  const { provider } = req.body;
  const validProviders = ['deepseek', 'tongyi', 'wenxin', 'siliconflow'];
  if (!validProviders.includes(provider)) {
    return res.status(400).json({ error: `不支持的 provider: ${provider}，可选值: ${validProviders.join(', ')}` });
  }
  try {
    const configPath = path.join(__dirname, 'config.yaml');
    let raw = fs.readFileSync(configPath, 'utf8');

    // v2.9.6 修复：逐行替换，彻底规避 /m 正则在 Windows CRLF 下的失效问题
    // provider 行格式：'  provider: deepseek'（前面两个空格）
    let replaced = false;
    const newLines = raw.split('\n').map(line => {
      if (!replaced && /^\s{0,4}provider:\s*\S+/.test(line)) {
        replaced = true;
        return line.replace(/(\s{0,4}provider:\s*)\S+/, `$1${provider}`);
      }
      return line;
    });
    if (!replaced) {
      return res.status(500).json({ error: 'config.yaml 中未找到 provider 字段，请检查配置文件' });
    }
    fs.writeFileSync(configPath, newLines.join('\n'), 'utf8');
    res.json({ ok: true, provider });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════
// POST /api/config/sf-key  —— 保存硅基流动 API Key（v2.9.5 修复正则 + 安全加固）
// Body: { api_key }
// 返回: { ok: true }
// 安全：key 仅写入服务端 config.yaml，不在任何 GET 接口中返回明文
// ═══════════════════════════════════════════════════════════════
app.post('/api/config/sf-key', (req, res) => {
  const { api_key } = req.body;
  if (!api_key || !api_key.startsWith('sk-')) {
    return res.status(400).json({ error: 'API Key 格式不正确，须以 sk- 开头' });
  }
  try {
    const configPath = path.join(__dirname, 'config.yaml');
    let raw = fs.readFileSync(configPath, 'utf8');

    // v2.9.5 修复：逐行替换，彻底规避正则跨行匹配失效问题
    const lines = raw.split('\n');
    let inSFBlock = false;
    let replaced  = false;
    const newLines = lines.map(line => {
      // 进入 siliconflow: 块
      if (/^  siliconflow:/.test(line)) { inSFBlock = true; return line; }
      // 离开 siliconflow: 块（遇到下一个同级 key）
      if (inSFBlock && /^  \w/.test(line) && !/^\s+/.test(line.charAt(2))) {
        inSFBlock = false;
      }
      // 替换该块内的 api_key 行
      if (inSFBlock && /^\s+api_key:/.test(line) && !replaced) {
        replaced = true;
        return `    api_key: "${api_key}"`;
      }
      return line;
    });
    if (!replaced) {
      return res.status(500).json({ error: 'config.yaml 中未找到 siliconflow.api_key 字段，请检查配置文件格式' });
    }
    fs.writeFileSync(configPath, newLines.join('\n'), 'utf8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════
// POST /api/config/sf-model  —— 切换硅基流动文本模型（v2.9.7）
// Body: { model: 'deepseek-ai/DeepSeek-V3' | ... }
// ═══════════════════════════════════════════════════════════════
app.post('/api/config/sf-model', (req, res) => {
  const { model } = req.body;
  if (!model || typeof model !== 'string') {
    return res.status(400).json({ error: 'model 参数不能为空' });
  }
  try {
    const configPath = path.join(__dirname, 'config.yaml');
    let raw = fs.readFileSync(configPath, 'utf8');

    // 逐行替换 siliconflow 块内的 model 字段
    // YAML 结构：siliconflow:\n    api_key: ...\n    model: "..."
    let inSfBlock = false;
    let modelReplaced = false;
    const newLines = raw.split('\n').map(line => {
      if (/^  siliconflow:/.test(line)) { inSfBlock = true; return line; }
      if (inSfBlock && /^  \w/.test(line) && !/^    /.test(line)) { inSfBlock = false; }
      if (inSfBlock && !modelReplaced && /^\s{4}model:\s*/.test(line)) {
        modelReplaced = true;
        return line.replace(/(^\s{4}model:\s*).*/, `$1"${model}"`);
      }
      return line;
    });
    if (!modelReplaced) {
      return res.status(500).json({ error: 'config.yaml 中未找到 siliconflow.model 字段' });
    }
    fs.writeFileSync(configPath, newLines.join('\n'), 'utf8');
    res.json({ ok: true, model });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════
// POST /api/config/provider-key  —— 保存各备用 provider 的 API Key（v2.9.9）
// Body: { provider: 'deepseek'|'tongyi'|'wenxin', api_key, secret_key? }
// ═══════════════════════════════════════════════════════════════
app.post('/api/config/provider-key', (req, res) => {
  const { provider, api_key, secret_key } = req.body;
  const validProviders = ['deepseek', 'tongyi', 'wenxin'];
  if (!validProviders.includes(provider)) {
    return res.status(400).json({ error: `不支持的 provider: ${provider}` });
  }
  if (!api_key || api_key.trim().length < 4) {
    return res.status(400).json({ error: 'api_key 不能为空' });
  }
  try {
    const configPath = path.join(__dirname, 'config.yaml');
    let content = fs.readFileSync(configPath, 'utf8');
    const lines = content.split('\n');
    let inProviderSection = false;
    let apiKeyReplaced = false;
    let secretKeyReplaced = false;
    const newLines = lines.map(line => {
      // 检测进入 provider section
      const sectionMatch = line.match(/^(\s+)([a-z_]+):\s*$/);
      if (sectionMatch) {
        inProviderSection = (sectionMatch[2] === provider);
      }
      if (!inProviderSection) return line;
      // 替换 api_key
      const apiKeyMatch = line.match(/^(\s+)api_key:\s*/);
      if (apiKeyMatch && !apiKeyReplaced) {
        apiKeyReplaced = true;
        return `${apiKeyMatch[1]}api_key: "${api_key.trim()}"`;
      }
      // 替换 secret_key（仅文心一言）
      if (provider === 'wenxin' && secret_key) {
        const secretKeyMatch = line.match(/^(\s+)secret_key:\s*/);
        if (secretKeyMatch && !secretKeyReplaced) {
          secretKeyReplaced = true;
          return `${secretKeyMatch[1]}secret_key: "${secret_key.trim()}"`;
        }
      }
      return line;
    });
    if (!apiKeyReplaced) {
      return res.status(500).json({ error: `config.yaml 中未找到 ${provider}.api_key 字段` });
    }
    fs.writeFileSync(configPath, newLines.join('\n'), 'utf8');
    console.log(`  ✓ 已更新 ${provider}.api_key`);
    res.json({ ok: true, provider });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════
// GET /api/config/key-status  —— 查询各 provider key 是否已配置（v2.9.5）
// 返回掩码形式（不含明文），供前端"已配置"状态展示
// ═══════════════════════════════════════════════════════════════
app.get('/api/config/key-status', (req, res) => {
  try {
    const config = loadConfig();
    const ai = config.ai || {};

    function maskKey(key) {
      if (!key || key.startsWith('YOUR_') || key.length < 8) return null;
      // 显示前 6 位 + *** + 后 4 位
      return key.substring(0, 6) + '****' + key.slice(-4);
    }

    res.json({
      deepseek:    { configured: !!(ai.deepseek?.api_key   && !ai.deepseek.api_key.startsWith('YOUR_')),   masked: maskKey(ai.deepseek?.api_key)   },
      tongyi:      { configured: !!(ai.tongyi?.api_key     && !ai.tongyi.api_key.startsWith('YOUR_')),     masked: maskKey(ai.tongyi?.api_key)     },
      siliconflow: { configured: !!(ai.siliconflow?.api_key && !ai.siliconflow.api_key.startsWith('YOUR_')), masked: maskKey(ai.siliconflow?.api_key) },
      wenxin:      { configured: !!(ai.wenxin?.api_key     && !ai.wenxin.api_key.startsWith('YOUR_')),     masked: maskKey(ai.wenxin?.api_key)     },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════
// POST /api/gen-image  —— 异步 FLUX 配图生成（SiliconFlow）
// Body: { prompt, width?, height? }
// 返回: { url } 图片地址，或 { error }
// ═══════════════════════════════════════════════════════════════
app.post('/api/gen-image', async (req, res) => {
  const { prompt, width = 1024, height = 576, model: reqModel } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt 不能为空' });

  // 优先用 siliconflow 配置；若当前 provider 非 siliconflow 也允许调用（只要 key 填了）
  const config = loadConfig();
  const sfCfg  = config.ai?.siliconflow || {};
  const apiKey = sfCfg.api_key;
  // v2.9.9：FLUX.1-schnell 已被硅基流动下线，默认改用 Kwai-Kolors/Kolors
  const imageModel = reqModel || sfCfg.image_model || 'Kwai-Kolors/Kolors';
  // API Base：优先读 config，避免硬编码域名不一致
  const apiBase = (sfCfg.api_base || 'https://api.siliconflow.cn/v1').replace(/\/$/, '');

  if (!apiKey || apiKey.startsWith('YOUR_')) {
    return res.status(400).json({ error: '请先在设置中填写硅基流动 API Key' });
  }

  // ── 官方枚举：将任意 WxH 映射到最接近的合法 image_size ──────────
  // 官方仅支持: 512x512 | 768x1024 | 1024x768 | 576x1024 | 1024x576
  const VALID_SIZES = ['1024x576', '1024x768', '768x1024', '576x1024', '512x512'];
  function resolveImageSize(w, h) {
    const requested = `${w}x${h}`;
    if (VALID_SIZES.includes(requested)) return requested;
    // 按宽高比选最近的合法尺寸
    const ratio = w / h;
    if (ratio >= 1.6)  return '1024x576';  // 16:9
    if (ratio >= 1.2)  return '1024x768';  // 4:3
    if (ratio <= 0.62) return '576x1024';  // 9:16
    if (ratio <= 0.8)  return '768x1024';  // 3:4
    return '512x512';                       // 1:1
  }
  const imageSize = resolveImageSize(width, height);

  try {
    const _axios = require('axios');
    const axios  = _axios.default || _axios;

    console.log(`  🎨 生图请求 model=${imageModel} size=${imageSize} prompt="${prompt.substring(0, 40)}..."`);

    const r = await axios.post(
      `${apiBase}/images/generations`,
      {
        model:      imageModel,
        prompt:     prompt,
        image_size: imageSize,
        // ⚠️ 官方接口不支持 num_inference_steps，已移除
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type':  'application/json',
        },
        timeout: 90000,
        validateStatus: null,  // 不自动 throw，拿到 status 后再判断
      }
    );

    if (r.status === 401) {
      const errMsg = r.data?.message || 'API Key 无效';
      return res.status(401).json({ error: `硅基流动 401 认证失败：${errMsg}，请检查 API Key` });
    }
    if (r.status !== 200) {
      const errMsg = r.data?.message || r.data?.error?.message || `HTTP ${r.status}`;
      console.error(`  ✗ 生图失败 (${r.status}):`, r.data);
      return res.status(500).json({ error: `图片生成失败：${errMsg}` });
    }

    const imgUrl = r.data?.images?.[0]?.url || r.data?.data?.[0]?.url;
    if (!imgUrl) {
      console.error('  ✗ 接口返回数据:', JSON.stringify(r.data));
      throw new Error('接口未返回图片 URL，请检查模型名称是否正确');
    }
    console.log(`  ✓ 生图成功: ${imgUrl.substring(0, 60)}...`);
    res.json({ url: imgUrl });
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    console.error('  ✗ 生图异常:', msg);
    res.status(500).json({ error: `图片生成失败: ${msg}` });
  }
});


// ═══════════════════════════════════════════════════════════════
// POST /api/parse-url  —— 解析链接正文
// Body: { url }
// ═══════════════════════════════════════════════════════════════
app.post('/api/parse-url', async (req, res) => {
  const { url } = req.body;
  if (!url || !url.startsWith('http')) return res.status(400).json({ error: '请输入有效的 http/https 链接' });

  try {
    const _axios  = require('axios');
    const axios   = _axios.default || _axios;
    const cheerio = require('cheerio');
    const agent   = (() => {
      try { const https = require('https'); return new https.Agent({ rejectUnauthorized: false }); }
      catch(e) { return undefined; }
    })();

    const r = await axios({
      method: 'get', url, timeout: 15000,
      httpsAgent: agent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      maxRedirects: 5,
    });

    const $ = cheerio.load(r.data);
    $('script,style,nav,header,footer,iframe,noscript,.ad,.ads,.advertisement').remove();

    // 尝试多种正文提取策略
    let title = $('title').text().trim().replace(/\s*[-_|].*$/, '').trim()
      || $('h1').first().text().trim();

    let content = '';
    // 微信公众号文章
    if (url.includes('mp.weixin.qq.com')) {
      title   = $('#activity-name').text().trim() || title;
      content = $('#js_content').text().trim();
    }
    // 通用文章
    if (!content) {
      const candidates = ['article', 'main', '.article-content', '.content', '.post-content', '#content', '.entry-content'];
      for (const sel of candidates) {
        const t = $(sel).text().trim();
        if (t.length > 200) { content = t; break; }
      }
    }
    // 兜底：取最长的段落集合
    if (!content) {
      const blocks = [];
      $('p').each((_, el) => {
        const t = $(el).text().trim();
        if (t.length > 20) blocks.push(t);
      });
      content = blocks.join('\n\n');
    }

    content = content.replace(/\s{3,}/g, '\n\n').trim();
    if (content.length < 50) return res.status(422).json({ error: '无法提取正文，该页面可能需要登录或使用了动态渲染' });

    res.json({ title, content: content.substring(0, 8000), wordCount: content.replace(/\s/g, '').length });
  } catch (err) {
    res.status(500).json({ error: '链接解析失败：' + err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// 多风格档案管理 API
//   GET    /api/profiles           —— 获取所有风格档案列表
//   GET    /api/profiles/:id       —— 获取指定风格档案详情
//   POST   /api/profiles           —— 新建风格档案（含元信息）
//   POST   /api/profiles/:id/analyze —— 用 TXT 样本分析/迭代指定档案（SSE）
//   DELETE /api/profiles/:id       —— 删除指定档案
// ═══════════════════════════════════════════════════════════════

const PROFILES_DIR = path.join(__dirname, 'data', 'profiles');

function ensureProfilesDir() {
  if (!fs.existsSync(PROFILES_DIR)) fs.mkdirSync(PROFILES_DIR, { recursive: true });
  // 迁移旧的默认档案
  const oldPath = path.join(__dirname, 'data', 'style_profile.json');
  const newPath = path.join(PROFILES_DIR, 'yushtang.json');
  if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
    try {
      const old = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
      old._profileId   = 'yushtang';
      old._profileName = '豫事堂';
      old._profileIcon = '🏯';
      fs.writeFileSync(newPath, JSON.stringify(old, null, 2), 'utf8');
    } catch(e) {}
  }
}

// GET /api/profiles
app.get('/api/profiles', (req, res) => {
  try {
    ensureProfilesDir();
    const files = fs.readdirSync(PROFILES_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const raw  = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, f), 'utf8'));
          return {
            id:          raw._profileId   || f.replace('.json', ''),
            name:        raw._profileName || f.replace('.json', ''),
            icon:        raw._profileIcon || '📝',
            summary:     raw.summary || '',
            sample_count: raw._meta?.sample_count || 0,
            analyzed_at:  raw._meta?.analyzed_at   || raw._profileCreatedAt || '',
          };
        } catch(e) { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => {
        // 豫事堂排第一
        if (a.id === 'yushtang') return -1;
        if (b.id === 'yushtang') return 1;
        return (b.analyzed_at || '').localeCompare(a.analyzed_at || '');
      });
    res.json({ profiles: files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/profiles/:id
app.get('/api/profiles/:id', (req, res) => {
  try {
    ensureProfilesDir();
    const fp = path.join(PROFILES_DIR, req.params.id + '.json');
    if (!fs.existsSync(fp)) return res.status(404).json({ error: '档案不存在' });
    res.json(JSON.parse(fs.readFileSync(fp, 'utf8')));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/profiles  —— 新建空档案
// Body: { name, icon?, description? }
app.post('/api/profiles', (req, res) => {
  const { name, icon = '📝', description = '' } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '档案名称不能为空' });

  try {
    ensureProfilesDir();
    const id  = 'profile_' + Date.now();
    const profile = {
      _profileId:          id,
      _profileName:        name.trim(),
      _profileIcon:        icon,
      _profileDescription: description,
      _profileCreatedAt:   new Date().toISOString(),
      summary:             '尚未分析，请导入文章样本进行风格学习',
      _meta:               { sample_count: 0 },
    };
    fs.writeFileSync(path.join(PROFILES_DIR, id + '.json'), JSON.stringify(profile, null, 2), 'utf8');
    res.json({ success: true, id, name: profile._profileName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/profiles/:id
app.delete('/api/profiles/:id', (req, res) => {
  if (req.params.id === 'yushtang') return res.status(403).json({ error: '默认档案不可删除' });
  const fp = path.join(PROFILES_DIR, req.params.id + '.json');
  if (!fs.existsSync(fp)) return res.status(404).json({ error: '档案不存在' });
  try {
    fs.unlinkSync(fp);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/profiles/:id/analyze  —— 导入 TXT 样本，分析/迭代风格档案（SSE）
// Body: { samples: [{ title, content }], merge?: boolean }
app.post('/api/profiles/:id/analyze', async (req, res) => {
  sseSetup(res);
  const { samples = [], merge = true } = req.body;
  const profileId = req.params.id;

  if (!samples.length) { sseError(res, '请提供至少 1 篇文章样本'); return; }

  try {
    ensureProfilesDir();
    const config        = loadConfig();
    const styleAnalyzer = new StyleAnalyzer(config);

    // 构造 samples 格式
    const formatted = samples.map(s => ({
      title:        s.title || '样本文章',
      content_text: s.content,
    })).filter(s => s.content_text && s.content_text.length > 50);

    if (!formatted.length) { sseError(res, '有效样本不足，请确保每篇文章至少 50 字'); return; }

    sseSend(res, { type: 'progress', msg: `正在分析 ${formatted.length} 篇样本，提炼风格特征...` });

    const newProfile = await styleAnalyzer.analyze(formatted, (msg) => {
      sseSend(res, { type: 'progress', msg });
    });

    // 读取旧档案（若存在），合并元信息
    const fp = path.join(PROFILES_DIR, profileId + '.json');
    let oldProfile = {};
    if (fs.existsSync(fp)) {
      try { oldProfile = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch(e) {}
    }

    const saved = {
      ...newProfile,
      _profileId:          profileId,
      _profileName:        oldProfile._profileName || profileId,
      _profileIcon:        oldProfile._profileIcon || '📝',
      _profileDescription: oldProfile._profileDescription || '',
      _profileCreatedAt:   oldProfile._profileCreatedAt || new Date().toISOString(),
      _meta: {
        ...newProfile._meta,
        sample_count: (merge ? (oldProfile._meta?.sample_count || 0) : 0) + formatted.length,
        analyzed_at:  new Date().toISOString(),
      },
    };

    fs.writeFileSync(fp, JSON.stringify(saved, null, 2), 'utf8');
    sseDone(res, { type: 'done', profile: saved });

  } catch (err) {
    sseError(res, err.message);
  }
});



const REF_DIR = path.join(__dirname, 'data', 'ref-articles');

function ensureRefDir() {
  if (!fs.existsSync(REF_DIR)) fs.mkdirSync(REF_DIR, { recursive: true });
}

// ── GET /api/ref-articles ────────────────────────────────────
app.get('/api/ref-articles', (req, res) => {
  try {
    ensureRefDir();
    const files = fs.readdirSync(REF_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const raw  = fs.readFileSync(path.join(REF_DIR, f), 'utf8');
          const meta = JSON.parse(raw);
          return {
            id:         meta.id,
            title:      meta.title,
            wordCount:  meta.wordCount,
            createdAt:  meta.createdAt,
            preview:    meta.content.substring(0, 80).replace(/\s+/g, ' '),
          };
        } catch(e) { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ articles: files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/ref-articles ───────────────────────────────────
// Body: { title, content, profileId? }
app.post('/api/ref-articles', (req, res) => {
  const { title, content, profileId } = req.body;
  if (!title || !content) return res.status(400).json({ error: '标题和正文不能为空' });
  if (content.length < 50) return res.status(400).json({ error: '正文不足 50 字，请粘贴完整文章' });

  try {
    ensureRefDir();
    const id = `ref_${Date.now()}`;
    const article = {
      id,
      title:      title.trim(),
      content:    content.trim(),
      wordCount:  content.replace(/\s/g, '').length,
      createdAt:  new Date().toISOString(),
    };
    // 1. 保存到 ref-articles 目录（兼容旧版本）
    fs.writeFileSync(path.join(REF_DIR, `${id}.json`), JSON.stringify(article, null, 2), 'utf8');
    
    // 2. 如果指定了 profileId，保存到对应账号的文件夹（新功能）
    if (profileId && (profileId === 'yushtang' || profileId === 'zaiwang')) {
      const accountDir = path.join(__dirname, 'data', profileId);
      if (!fs.existsSync(accountDir)) {
        fs.mkdirSync(accountDir, { recursive: true });
      }
      // 保存为 txt 文件，格式：标题 + 换行 + 内容
      const txtContent = `${title}\n\n${content}`;
      const txtFileName = `${Date.now()}_${title.substring(0, 20).replace(/[^\w\u4e00-\u9fa5]/g, '')}.txt`;
      fs.writeFileSync(path.join(accountDir, txtFileName), txtContent, 'utf8');
      
      console.log(`✅ 已保存到 ${profileId} 账号文件夹：${txtFileName} (${content.length} 字符)`);
    }
    
    res.json({ success: true, id, title: article.title, wordCount: article.wordCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/ref-articles/:id ─────────────────────────────
app.delete('/api/ref-articles/:id', (req, res) => {
  const fp = path.join(REF_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: '文章不存在' });
  try {
    fs.unlinkSync(fp);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/fetch-article  —— 抓取文章链接并解析标题+正文（v2.9.4）
// Body: { url: string }
// 返回: { title, content, wordCount }
// 支持：微信公众号文章、普通网页（通过 cheerio 提取主体文本）
// ═══════════════════════════════════════════════════════════════
app.post('/api/fetch-article', async (req, res) => {
  const { url } = req.body;
  if (!url || !url.startsWith('http')) return res.status(400).json({ error: '请提供有效的 http/https 链接' });

  try {
    const _axios   = require('axios');
    const axios    = _axios.default || _axios;
    const cheerio  = require('cheerio');

    const r = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      maxRedirects: 5,
    });

    const $ = cheerio.load(r.data);

    // 去除脚本/样式/导航/广告等无关元素
    $('script,style,nav,footer,header,aside,.ad,.ads,.advertisement,#sidebar,.sidebar').remove();

    // 优先尝试提取标题
    let title =
      $('meta[property="og:title"]').attr('content') ||
      $('meta[name="title"]').attr('content') ||
      $('h1').first().text().trim() ||
      $('title').text().trim() ||
      '未知标题';
    title = title.replace(/\s+/g, ' ').trim().substring(0, 200);

    // 提取正文：优先尝试微信/常见富文本容器
    let contentHtml = '';
    const selectors = [
      '#js_content',          // 微信公众号正文
      'article',
      '.article-content',
      '.post-content',
      '.entry-content',
      '.content',
      'main',
    ];
    for (const sel of selectors) {
      const el = $(sel);
      if (el.length && el.text().trim().length > 100) {
        contentHtml = el.text();
        break;
      }
    }
    // 兜底：提取 body 所有 p 标签文本
    if (!contentHtml || contentHtml.trim().length < 100) {
      contentHtml = $('p').map((_, el) => $(el).text().trim()).get().filter(t => t.length > 20).join('\n\n');
    }
    // 再兜底：body 全文
    if (!contentHtml || contentHtml.trim().length < 50) {
      contentHtml = $('body').text();
    }

    const content = contentHtml
      .replace(/\t/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .substring(0, 30000); // 限制 3 万字

    if (content.length < 50) {
      return res.status(422).json({ error: '无法从该链接提取到足够的正文内容（可能需要登录或内容被加密）' });
    }

    res.json({ title, content, wordCount: content.replace(/\s/g, '').length });
  } catch (err) {
    const msg = err.response
      ? `请求失败（HTTP ${err.response.status}）`
      : err.code === 'ECONNABORTED' || err.message.includes('timeout')
        ? '请求超时，该网站响应较慢'
        : err.message;
    res.status(500).json({ error: msg });
  }
});


// Body: {
//   refIds: string[],      —— 选中的参考文章 id
//   topic: string,         —— 写作主题
//   extraNote?: string,    —— 补充说明
//   imitateMode?: 'quick'|'deep',  —— 快速/深度
//   useTavily?: boolean,   —— 是否用 Tavily 补充材料
//   profileId?: string,    —— 使用的风格档案ID（默认 yushtang）
//   styleChip?: string,    —— v2.9.7 风格预设
// }
app.post('/api/imitate', async (req, res) => {
  sseSetup(res);
  const {
    refIds = [],
    topic,
    extraNote = '',
    imitateMode = 'quick',
    useTavily   = false,
    profileId   = 'yushtang',
    styleChip   = 'yushtang',  // v2.9.7：新增
  } = req.body;

  if (!refIds.length) { sseError(res, '请至少选择 1 篇参考文章'); return; }
  if (!topic)         { sseError(res, '请填写本次想写的主题'); return; }

  try {
    ensureRefDir();
    ensureProfilesDir();
    let config = loadConfig();

    // ── v2.9.8+ 自动 provider 路由 ──────────────────────────────
    const sfKey = config.ai?.siliconflow?.api_key;
    const hasSfKey = sfKey && !sfKey.startsWith('YOUR_') && sfKey.length > 8;
    if (hasSfKey && config.ai?.provider !== 'siliconflow') {
      config = { ...config, ai: { ...config.ai, provider: 'siliconflow' } };
      console.log('  🔀 仿写：自动切换到硅基流动');
    }
    // ─────────────────────────────────────────────────────────────

    const styleAnalyzer = new StyleAnalyzer(config);
    const rewriter      = new AIRewriter(config);

    // Step 1: 读取参考文章
    sseSend(res, { type: 'progress', step: 1, msg: '正在读取参考文章...' });
    const refArticles = [];
    for (const id of refIds.slice(0, 5)) {
      const fp = path.join(REF_DIR, `${id}.json`);
      if (!fs.existsSync(fp)) continue;
      try {
        const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
        refArticles.push(data);
      } catch(e) {}
    }
    if (!refArticles.length) { sseError(res, '参考文章读取失败，请重新上传'); return; }

    // Step 2: 加载风格档案（支持多档案）
    sseSend(res, { type: 'progress', step: 2, msg: '分析参考风格，构建仿写指令...' });

    let profile = null;
    // v3.0.2 修复：优先尝试加载档案文件（即使是预设风格）
    const profilePath = path.join(PROFILES_DIR, profileId + '.json');
    if (fs.existsSync(profilePath)) {
      try { profile = JSON.parse(fs.readFileSync(profilePath, 'utf8')); } catch(e) {}
    }
    // 兜底：如果文件不存在，读旧版默认档案（用于内置风格如 yushtang）
    if (!profile) {
      profile = styleAnalyzer.loadProfile();
    }

    // 构建参考文本注入
    const refTexts = refArticles.map((a, i) =>
      `### 参考原文 ${i+1}：${a.title}\n${a.content.substring(0, imitateMode === 'deep' ? 3000 : 2000)}`
    ).join('\n\n---\n\n');

    let styleInstruction = '';
    // v2.9.8补丁：styleChip=ref 时，完全按参考文章风格，忽略风格档案
    if (styleChip === 'ref') {
      styleInstruction = `## 写作风格要求（使用参考文章风格）\n请仔细学习以下参考原文的写作风格，包括：\n- 用词习惯和词汇偏好\n- 句式长短与表达方式\n- 段落结构和叙述节奏\n- 开头、过渡和结尾的写法\n- 语气和情感基调\n\n请严格模仿这种风格，写一篇关于新主题的文章。\n\n${refTexts}`;
    } else if (profile && profile.writing_instructions) {
      // 使用自定义档案的风格指令
      const basePrompt = styleAnalyzer.profileToPrompt(profile, []);
      styleInstruction = `${basePrompt}\n\n## 参考原文（请仔细学习以下文章的用词、句式、结构和语气）\n\n${refTexts}`;
    } else {
      // 无档案或预设风格时使用通用指令
      styleInstruction = `## 写作风格要求\n请仔细学习以下参考原文的写作风格（包括用词、句式长短、叙述节奏、段落结构），然后以同样的风格写一篇新文章。\n\n${refTexts}`;
    }

    if (extraNote) styleInstruction += `\n\n## 额外要求\n${extraNote}`;

    // v2.9.7：styleChip 风格强化指令（ref 分支已在上方处理，此处跳过）
    // v3.0.2：添加载望学科和更多预设风格
    const STYLE_CHIP_PROMPTS = {
      yushtang:  '## 写作风格偏好\n写作风格：豫事堂公众号风格，要求贴近民生、政务科普类叙述，语言亲切易懂，适度带入河南/郑州本地感，段落节奏轻快，结尾注重互动引导。',
      zaiwang:   '## 写作风格偏好\n写作风格：载望学科公众号风格，聚焦高等教育、学科发展、科研动态，语言专业严谨但不失可读性，注重数据引用和趋势分析，段落结构清晰，适合高校师生和科研人员阅读。',
      news:      '## 写作风格偏好\n写作风格：新闻报道风格，客观简洁，语言精炼，以事实为主，减少主观评价，重要信息前置，段落短而有力。',
      depth:     '## 写作风格偏好\n写作风格：深度解析风格，充分引用数据和权威来源，多角度分析，有完整的论证逻辑，段落详实，字数不少于1500字。',
      interact:  '## 写作风格偏好\n写作风格：互动轻松风格，口语化表达，适时设置提问，结尾引导读者评论和分享，语气活泼自然。',
      ref:       '',  // v2.9.8补丁：使用参考文章风格，已在上方单独处理
      none:      '',  // 无风格偏好，AI 自由发挥
      custom:    '',  // 自定义，已体现在 extraNote 里
    };
    if (styleChip !== 'ref') {
      const chipPrompt = STYLE_CHIP_PROMPTS[styleChip] || '';
      if (chipPrompt) styleInstruction += '\n\n' + chipPrompt;
    }

    if (imitateMode === 'deep') {
      styleInstruction += '\n\n## 深度模式要求\n请进行更深入的分析和创作：详细展开每个论点，提供更多论据和案例，文章长度不少于 2000 字，结构更完整，观点更有深度。';
    }

    rewriter.setStylePrompt(styleInstruction);

    // Step 2.5: Tavily 补充材料（深度模式）
    let tavilyContext = '';
    if (useTavily) {
      sseSend(res, { type: 'progress', step: 2, msg: '正在用 Tavily 搜索补充材料...' });
      try {
        const scraper = new NewsScraper(config);
        const tavilyArticles = await scraper.fetchWithTavily(topic, { maxResults: 6 });
        if (tavilyArticles && tavilyArticles.length) {
          tavilyContext = '\n\n## 补充资料（来源：Tavily 全网搜索）\n'
            + tavilyArticles.map((a, i) =>
                `${i+1}. 【${a.source || ''}】${a.title}\n   摘要：${(a.content || '').substring(0, 200)}`
              ).join('\n');
          rewriter.setStylePrompt(styleInstruction + tavilyContext);
          sseSend(res, { type: 'progress', step: 2, msg: `Tavily 补充了 ${tavilyArticles.length} 条资料` });
        }
      } catch(e) {
        sseSend(res, { type: 'progress', step: 2, msg: 'Tavily 搜索失败，继续使用参考文章仿写...' });
      }
    }

    // Step 3: AI 仿写
    sseSend(res, { type: 'progress', step: 3, msg: `AI 正在${imitateMode === 'deep' ? '深度' : '快速'}仿写「${topic}」...` });
    const topicArticle = {
      title:   topic,
      content: `请以"${topic}"为主题，创作一篇完整的微信公众号文章。${extraNote ? `\n补充要求：${extraNote}` : ''}`,
      url:     '',
      source:  '用户指定主题',
    };
    const result = await rewriter.singleRewrite(topicArticle, styleChip);

    // Step 4: 保存
    sseSend(res, { type: 'progress', step: 4, msg: '仿写完成，正在保存...' });
    const formatter    = new MarkdownFormatter(config);
    const savedResults = formatter.saveAll([result]);
    const saved        = savedResults[0];

    sseDone(res, {
      type:      'done',
      title:     result.title,
      summary:   result.summary,
      content:   result.content,
      tags:      result.tags,
      wordCount: result.content.replace(/\s/g, '').length,
      savedFile: saved?.success ? saved.filepath : null,
      refTitles: refArticles.map(a => a.title),
      profileName: profile ? (profile._profileName || '默认档案') : '参考文章风格',
    });

  } catch (err) {
    sseError(res, err.message);
  }
});


// ─── 启动（自动寻找可用端口）──────────────────────────────────
function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`\n╔═══════════════════════════════════════════╗`);
    console.log(`║  公众号自动化写作工具 - Web界面            ║`);
    console.log(`║  WeChat Auto Writer  v3.0 智能内容中枢     ║`);
    console.log(`╚═══════════════════════════════════════════╝`);
    console.log(`\n  请在浏览器打开：http://localhost:${port}\n`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`  端口 ${port} 已被占用，正在尝试端口 ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('服务器启动失败：', err.message);
      process.exit(1);
    }
  });
}

const BASE_PORT = parseInt(process.env.PORT, 10) || 3000;
startServer(BASE_PORT);
