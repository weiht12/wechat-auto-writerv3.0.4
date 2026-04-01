'use strict';

/**
 * 每日河南热点模块
 *
 * 数据来源（三路并行）：
 *   1. 大河财立方  https://www.dahecube.com/
 *      API: POST https://app.dahecube.com/napi/news/pc/list
 *      channelid=1（推荐）+ channelid=2（政经）
 *
 *   2. 河南省政府  https://www.henan.gov.cn/
 *      HTML 解析：li.dh_modular_news > a
 *
 *   3. 百度新闻    https://news.baidu.com/
 *      关键词搜索（河南发展、郑州规划等）
 *
 * 汇总后由 AI 按堂主偏好提炼 10 个热点话题，附选题角度建议。
 */

const _axiosModule = require('axios');
const axios = _axiosModule.default || _axiosModule;
const cheerio = require('cheerio');
const { OpenAI } = require('openai');
const fs   = require('fs');
const path = require('path');
const chalk = require('chalk');
const ora   = require('ora');
const inquirer = require('inquirer');

// ─── 常量配置 ──────────────────────────────────────────────────
const DAHECUBE_API  = 'https://app.dahecube.com/napi/news/pc/list';
const HENAN_GOV_URL = 'https://www.henan.gov.cn/';
const CACHE_PATH    = path.join(__dirname, '..', 'data', 'hot_topics_cache.json');

const BAIDU_KEYWORDS = [
  '河南发展', '郑州规划', '河南高铁', '河南机场', '河南工程项目',
  '河南城市', '河南经济', '河南基础设施',
];

// 监控站点配置（可扩展）
const WATCH_SITES = [
  {
    id: 'dahecube',
    label: '大河财立方',
    url: 'https://www.dahecube.com/',
    fetch: fetchDahecube,
  },
  {
    id: 'henan_gov',
    label: '河南省政府',
    url: 'https://www.henan.gov.cn/',
    fetch: fetchHenanGov,
  },
];

// ─── HTTP 工具 ─────────────────────────────────────────────────
const _httpsAgent = (() => {
  try { const https = require('https'); return new https.Agent({ rejectUnauthorized: false }); }
  catch(e) { return undefined; }
})();

function httpGet(url, extraHeaders = {}, timeout = 12000) {
  return axios({
    method: 'get', url, timeout,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      ...extraHeaders,
    },
    maxRedirects: 5,
    httpsAgent: _httpsAgent,
  });
}

function httpPost(url, data, extraHeaders = {}, timeout = 12000) {
  return axios({
    method: 'post', url, data: JSON.stringify(data), timeout,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Content-Type': 'application/json',
      'Accept': 'application/json, */*',
      'Referer': 'https://www.dahecube.com/',
      'Origin': 'https://www.dahecube.com',
      ...extraHeaders,
    },
    httpsAgent: _httpsAgent,
  });
}

// ─── 数据源1：大河财立方（调用官方内部 API）──────────────────
async function fetchDahecube() {
  const articles = [];
  // channel 1=推荐，channel 2=政经（均含河南本地内容）
  for (const channelid of [1, 2]) {
    try {
      const res = await httpPost(DAHECUBE_API, { channelid, pno: 1, psize: 15 });
      const items = res.data?.data?.items || [];
      for (const item of items) {
        if (!item.title) continue;
        articles.push({
          title:  item.title,
          url:    item.linkurl || `https://www.dahecube.com/article.html?artid=${item.recid}`,
          time:   item.pubtime || '',
          source: '大河财立方',
        });
      }
    } catch (e) { /* 单个 channel 失败不影响另一个 */ }
  }
  return articles;
}

// ─── 数据源2：河南省政府（HTML 解析）────────────────────────
async function fetchHenanGov() {
  const articles = [];
  try {
    const res = await httpGet(HENAN_GOV_URL, { 'Referer': 'https://www.henan.gov.cn/' });
    const $ = cheerio.load(res.data);
    const seen = new Set();

    // 主要新闻：li.dh_modular_news > a
    $('li.dh_modular_news a').each((i, el) => {
      const title = $(el).text().trim().replace(/\s+/g, ' ');
      let href    = $(el).attr('href') || '';
      if (!href.startsWith('http')) href = 'https://www.henan.gov.cn' + href;
      if (title.length >= 8 && title.length <= 80 && !seen.has(title)) {
        seen.add(title);
        articles.push({ title, url: href, time: '', source: '河南省政府' });
      }
    });

    // 补充：h3 > a（省政府常务会议等要闻）
    $('h3 a, h4 a').each((i, el) => {
      const title = $(el).text().trim().replace(/\s+/g, ' ');
      let href    = $(el).attr('href') || '';
      if (!href.startsWith('http')) href = 'https://www.henan.gov.cn' + href;
      if (title.length >= 8 && title.length <= 80 && !seen.has(title)) {
        seen.add(title);
        articles.push({ title, url: href, time: '', source: '河南省政府' });
      }
    });
  } catch (e) { /* 失败静默 */ }
  return articles;
}

// ─── 数据源3：百度新闻关键词搜索 ─────────────────────────────
async function fetchBaiduNews() {
  const articles = [];
  const seen = new Set();

  for (const kw of BAIDU_KEYWORDS) {
    try {
      const url = `https://news.baidu.com/ns?word=${encodeURIComponent(kw)}&tn=news&from=news&cl=2&pn=0&rn=20&ct=1`;
      const res = await httpGet(url, { 'Referer': 'https://news.baidu.com/' });
      const $ = cheerio.load(res.data);

      $('a').each((i, el) => {
        const title = $(el).text().trim().replace(/\s+/g, ' ');
        const href  = $(el).attr('href') || '';
        if (
          title.length >= 10 && title.length <= 80 &&
          href.startsWith('http') &&
          !seen.has(title) &&
          !title.includes('广告') && !title.includes('招聘')
        ) {
          seen.add(title);
          articles.push({ title, url: href, time: '', source: `百度新闻·${kw}` });
        }
        if (articles.filter(a => a.source.includes(kw)).length >= 6) return false;
      });
      await _sleep(350);
    } catch (e) { /* 单个关键词失败跳过 */ }
  }
  return articles;
}

// ─── AI 提炼热点话题 ──────────────────────────────────────────
async function extractTopics(ai, model, rawArticles) {
  // 按来源分组展示，让 AI 了解内容来源
  const grouped = {};
  for (const a of rawArticles) {
    const src = a.source.includes('大河财立方') ? '大河财立方'
              : a.source.includes('河南省政府') ? '河南省政府'
              : '百度新闻';
    if (!grouped[src]) grouped[src] = [];
    grouped[src].push(a.title);
  }

  const titlesText = Object.entries(grouped).map(([src, titles]) =>
    `【${src}】\n${titles.slice(0, 20).map((t, i) => `${i+1}. ${t}`).join('\n')}`
  ).join('\n\n');

  const styleHint = `堂主的选题偏好：
- 核心主题：河南区域发展规划、城市竞争比较、交通基础设施（高铁/机场/城际）
- 关注点：国企动态、工业产业、政策落地、城市排名数据
- 风格：犀利直白、善用数据、有地域情感、挖掘争议性角度`;

  const prompt = `以下是今日从三个来源（大河财立方、河南省政府、百度新闻）抓取的河南最新资讯：

${titlesText}

${styleHint}

请从中筛选出最值得"堂主"写成公众号文章的 10 个热点话题。
要求：
1. 优先选择有数据、有争议、有地域对比的内容
2. 每个话题给一个具体"选题角度"（30字内），说明从哪个切入点写
3. 注明原始来源（大河财立方/河南省政府/百度新闻）

格式（严格按此输出，共10行，每行用|分隔）：
序号|话题标题|选题角度|来源

只输出10行，不要其他任何内容。`;

  const resp = await ai.chat.completions.create({
    model,
    temperature: 0.5,
    messages: [
      { role: 'system', content: '你是专注河南地区的公众号选题编辑，熟悉本地读者关注点。' },
      { role: 'user', content: prompt },
    ],
  });

  const raw = resp.choices[0].message.content.trim();
  const topics = [];

  for (const line of raw.split('\n')) {
    const parts = line.split('|');
    if (parts.length < 3) continue;
    const no     = parts[0].trim().replace(/[^\d]/g, '');
    const title  = (parts[1] || '').trim();
    const angle  = (parts[2] || '').trim();
    const source = (parts[3] || '').trim();
    if (no && title) topics.push({
      no: parseInt(no, 10) || topics.length + 1,
      title, angle, source,
    });
  }

  return topics.slice(0, 10);
}

// ─── 主类 ────────────────────────────────────────────────────
class HotTopics {
  constructor(config) {
    this.config   = config;
    this.aiConfig = config.ai || {};
    this.provider = this.aiConfig.provider || 'deepseek';
    const cfg = this.aiConfig[this.provider] || {};
    this.ai    = new OpenAI({ apiKey: cfg.api_key || '', baseURL: cfg.api_base || 'https://api.deepseek.com/v1' });
    this.model = cfg.model || 'deepseek-chat';
  }

  // ─── 主入口 ──────────────────────────────────────────────────
  async run() {
    console.log(chalk.blue('\n🔥 每日河南热点\n'));

    // 检查今日缓存
    const cached = this._loadCache();
    if (cached) {
      console.log(chalk.gray(`  （使用今日缓存，生成于 ${cached.generated_at.substring(11, 16)}）\n`));
      this._printTopics(cached.topics, cached.site_stats);
      await this._askAction(cached.topics);
      return;
    }

    // 三路并行抓取
    const spinner = ora('正在从大河财立方、河南省政府、百度新闻同步抓取最新资讯...').start();
    let allArticles = [];
    const siteStats = {};

    const results = await Promise.allSettled([
      fetchDahecube(),
      fetchHenanGov(),
      fetchBaiduNews(),
    ]);

    const labels = ['大河财立方', '河南省政府', '百度新闻'];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const label = labels[i];
      if (r.status === 'fulfilled') {
        siteStats[label] = r.value.length;
        allArticles = allArticles.concat(r.value);
      } else {
        siteStats[label] = 0;
      }
    }

    const statusLine = Object.entries(siteStats)
      .map(([k, v]) => `${k} ${v > 0 ? chalk.green(v+'条') : chalk.red('失败')}`)
      .join('  ');
    spinner.succeed(`抓取完成  ${statusLine}`);

    if (allArticles.length === 0) {
      console.log(chalk.yellow('  ⚠️  三个数据源均抓取失败，请检查网络后重试'));
      return;
    }

    // AI 提炼
    const spinner2 = ora(`AI 正在从 ${allArticles.length} 条资讯中提炼 10 个热点话题...`).start();
    let topics = [];
    try {
      topics = await extractTopics(this.ai, this.model, allArticles);
      spinner2.succeed('热点话题提炼完成！');
    } catch (e) {
      spinner2.fail(`AI 提炼失败：${e.message}`);
      return;
    }

    // 缓存
    this._saveCache(topics, siteStats);

    // 展示
    console.log('');
    this._printTopics(topics, siteStats);
    await this._askAction(topics);
  }

  // ─── 展示热点列表 ────────────────────────────────────────────
  _printTopics(topics, siteStats = {}) {
    const today = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });

    console.log(chalk.cyan(`╔${'═'.repeat(60)}╗`));
    console.log(chalk.cyan(`║`) + chalk.bold(`  🔥 今日河南热点  ${today}`.padEnd(60)) + chalk.cyan(`║`));

    // 数据来源状态栏
    if (Object.keys(siteStats).length > 0) {
      const srcLine = Object.entries(siteStats)
        .map(([k, v]) => `${k}(${v}条)`)
        .join(' | ');
      console.log(chalk.cyan(`║`) + chalk.gray(`  数据来源：${srcLine}`.padEnd(60)) + chalk.cyan(`║`));
    }

    console.log(chalk.cyan(`╚${'═'.repeat(60)}╝\n`));

    topics.forEach(t => {
      const num = chalk.yellow(`  ${String(t.no).padStart(2, ' ')}. `);
      console.log(num + chalk.bold.white(t.title));

      const parts = [];
      if (t.angle)  parts.push(chalk.gray(`选题角度：${t.angle}`));
      if (t.source) parts.push(chalk.blue(`[${t.source}]`));
      if (parts.length) console.log(`      ${parts.join('  ')}`);
      console.log('');
    });
  }

  // ─── 询问下一步操作 ──────────────────────────────────────────
  async _askAction(topics) {
    const choices = [
      ...topics.map(t => ({
        name: `[${t.no}] ${t.title.substring(0, 50)}`,
        value: t.title,
      })),
      new inquirer.Separator('──────────────'),
      { name: '🔄 刷新（忽略缓存，重新抓取）', value: '__refresh__' },
      { name: '↩  返回主菜单', value: null },
    ];

    const { selected } = await inquirer.prompt([{
      type: 'list',
      name: 'selected',
      message: '选择一个话题直接生成文章，或其他操作：',
      choices,
    }]);

    if (selected === '__refresh__') {
      // 删缓存后重新执行
      try { fs.unlinkSync(CACHE_PATH); } catch(e) {}
      await this.run();
    } else if (selected) {
      console.log(chalk.green(`\n  ✓ 已选择话题：「${selected}」`));
      const tmpPath = path.join(__dirname, '..', 'data', '.pending_topic.txt');
      fs.writeFileSync(tmpPath, selected, 'utf8');
      console.log(chalk.yellow('  💡 请回到主菜单选择「✍️  生成新文章」，关键词已自动填入。\n'));
    }
  }

  // ─── 缓存管理 ────────────────────────────────────────────────
  _loadCache() {
    try {
      if (!fs.existsSync(CACHE_PATH)) return null;
      const c = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
      const today = new Date().toISOString().substring(0, 10);
      if (c.date !== today) return null;
      return c;
    } catch (e) { return null; }
  }

  _saveCache(topics, siteStats) {
    try {
      fs.writeFileSync(CACHE_PATH, JSON.stringify({
        date:         new Date().toISOString().substring(0, 10),
        generated_at: new Date().toISOString(),
        site_stats:   siteStats,
        topics,
      }, null, 2), 'utf8');
    } catch (e) { /* 缓存失败不影响主流程 */ }
  }
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = HotTopics;
