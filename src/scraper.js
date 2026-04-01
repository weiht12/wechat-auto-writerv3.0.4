/**
 * 新闻抓取模块
 * 支持百度新闻、今日头条内容聚合
 */

'use strict';

const _axiosModule = require('axios');
const axios = _axiosModule.default || _axiosModule;
const cheerio = require('cheerio');

// 统一的 HTTP 请求函数（替代 axios.create，避免版本兼容问题）
async function httpGet(url, extraHeaders = {}, timeout = 15000) {
  return axios({
    method: 'get',
    url,
    timeout,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      ...extraHeaders
    },
    maxRedirects: 5,
    // 忽略 SSL 错误
    httpsAgent: (() => {
      try {
        const https = require('https');
        return new https.Agent({ rejectUnauthorized: false });
      } catch(e) { return undefined; }
    })()
  });
}

class NewsScraper {
  constructor(config) {
    this.config = config.scraper;
    this.tavilyApiKey = config.tavily?.api_key || process.env.TAVILY_API_KEY || '';
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 从百度新闻抓取文章列表（含关键词搜索）
   */
  async fetchFromBaidu(keyword = '') {
    const articles = [];
    try {
      let url;
      if (keyword) {
        url = `https://news.baidu.com/ns?word=${encodeURIComponent(keyword)}&tn=news&from=news&cl=2&pn=0&rn=20&ct=1`;
      } else {
        url = 'https://news.baidu.com/';
      }

      const response = await httpGet(url, { 'Referer': 'https://news.baidu.com/' }, this.config.timeout * 1000);
      const $ = cheerio.load(response.data);
      const seen = new Set();

      // 优先选择器（根据实测有效）
      const primarySelectors = [
        '.hotnews a',
        '.mod-tab-pane a',
        'a[href*="baijiahao.baidu.com"]',
        'a[href*="news.cctv.com"]',
        'a[href*="xinhuanet.com"]',
        'a[href*="people.com.cn"]'
      ];

      for (const selector of primarySelectors) {
        $(selector).each((i, el) => {
          const $el = $(el);
          const title = $el.text().trim();
          const href = $el.attr('href') || '';

          if (
            title.length > 8 &&
            title.length < 100 &&
            href.startsWith('http') &&
            !href.includes('javascript') &&
            !seen.has(title)
          ) {
            seen.add(title);
            articles.push({
              title,
              url: href,
              source: '百度新闻',
              fetchedAt: new Date().toISOString()
            });
          }
        });
      }

      // 搜索结果页的选择器（有关键词时）
      if (keyword && articles.length < 3) {
        $('a').each((i, el) => {
          const $el = $(el);
          const title = $el.text().trim();
          const href = $el.attr('href') || '';
          if (
            title.length > 10 && title.length < 100 &&
            href.startsWith('http') &&
            !href.includes('baidu.com/s?') &&
            !href.includes('javascript') &&
            !seen.has(title)
          ) {
            seen.add(title);
            articles.push({
              title,
              url: href,
              source: '百度新闻',
              fetchedAt: new Date().toISOString()
            });
          }
        });
      }
    } catch (error) {
      console.error('  ✗ 百度新闻抓取失败:', error.message);
    }

    return articles.slice(0, this.config.max_articles * 3);
  }

  /**
   * 从今日头条抓取文章列表
   */
  async fetchFromToutiao(keyword = '') {
    const articles = [];
    try {
      const url = keyword
        ? `https://www.toutiao.com/search/?keyword=${encodeURIComponent(keyword)}`
        : 'https://www.toutiao.com/';

      const response = await httpGet(url, {
        'Referer': 'https://www.toutiao.com/',
        'Cookie': 'tt_webid=1'
      }, this.config.timeout * 1000);

      const $ = cheerio.load(response.data);
      const seen = new Set();

      $('a').each((i, el) => {
        const $el = $(el);
        const title = $el.text().trim();
        const href = $el.attr('href') || '';

        if (
          title.length > 10 && title.length < 100 &&
          (href.includes('/article/') || href.includes('toutiao.com')) &&
          href.startsWith('http') &&
          !seen.has(title)
        ) {
          seen.add(title);
          articles.push({
            title,
            url: href,
            source: '今日头条',
            fetchedAt: new Date().toISOString()
          });
        }
      });
    } catch (error) {
      console.error('  ✗ 今日头条抓取失败:', error.message);
    }

    return articles.slice(0, this.config.max_articles * 3);
  }

  /**
   * 获取文章正文内容
   */
  async fetchArticleContent(url) {
    try {
      await this.sleep(this.config.delay * 1000);

      const response = await httpGet(url, {
        'Referer': 'https://news.baidu.com/'
      }, this.config.timeout * 1000);

      const $ = cheerio.load(response.data);

      // 移除无用元素
      $('script, style, nav, header, footer, .ad, .advertisement, .comment, .related, aside, .sidebar, iframe, .recommend').remove();

      // 提取标题
      const title =
        $('h1').first().text().trim() ||
        $('meta[property="og:title"]').attr('content') ||
        $('title').text().trim() || '';

      // 正文提取优先级
      const contentSelectors = [
        'article',
        '.article-content',
        '.article-body',
        '.detail-content',
        '.content-article',
        '#js_content',          // 微信公众号
        '.post-content',
        '.entry-content',
        '.tj-article',
        '.ba-text',             // 百家号
        '[class*="article"]',
        '[class*="content"]',
        'main',
        '#content'
      ];

      let content = '';
      for (const selector of contentSelectors) {
        const el = $(selector).first();
        if (el.length > 0) {
          const text = el.text().replace(/\s+/g, ' ').trim();
          if (text.length > content.length && text.length > 100) {
            content = text;
          }
        }
      }

      if (content.length < 100) {
        // 兜底1：提取所有 p 标签内容
        const paragraphs = [];
        $('p').each((i, el) => {
          const t = $(el).text().trim();
          if (t.length > 20) paragraphs.push(t);
        });
        if (paragraphs.length > 0) {
          content = paragraphs.join('\n\n');
        }
      }

      if (content.length < 100) {
        // 兜底2：直接提取 body 所有可见文本（去掉过短片段）
        const chunks = [];
        $('body *').each((i, el) => {
          const tag = (el.tagName || '').toLowerCase();
          if (['script','style','nav','header','footer'].includes(tag)) return;
          const t = $(el).clone().children().remove().end().text().trim();
          if (t.length > 30) chunks.push(t);
        });
        content = [...new Set(chunks)].join('\n\n');
      }

      const source =
        $('meta[property="og:site_name"]').attr('content') ||
        $('meta[name="author"]').attr('content') || '';

      return {
        title: title.substring(0, 100),
        content: content.substring(0, 8000),
        source,
        url
      };
    } catch (error) {
      console.error(`  ✗ 获取正文失败 (${url.substring(0, 50)}...): ${error.message}`);
      return null;
    }
  }

  /**
   * 主抓取入口
   */
  async fetchNews(keyword = '', source = null, options = {}) {
    const targetSource = source || this.config.source;
    const useTavily = options.useTavily || false;
    let articleList = [];

    if (targetSource === 'baidu' || targetSource === 'both') {
      const items = await this.fetchFromBaidu(keyword);
      articleList = articleList.concat(items);
      console.log(`  ✓ 百度新闻抓取到 ${items.length} 条标题`);
    }

    if (targetSource === 'toutiao' || targetSource === 'both') {
      await this.sleep(this.config.delay * 1000);
      const items = await this.fetchFromToutiao(keyword);
      articleList = articleList.concat(items);
      console.log(`  ✓ 今日头条抓取到 ${items.length} 条标题`);
    }

    // Tavily 全网搜索
    if (useTavily) {
      await this.sleep(this.config.delay * 1000);
      const tavilyItems = await this.fetchWithTavily(keyword, {
        maxResults: this.config.max_articles,
        searchDepth: 'basic'
      });
      articleList = articleList.concat(tavilyItems);
    }

    // 标题去重
    const seen = new Set();
    articleList = articleList.filter(a => {
      if (seen.has(a.title)) return false;
      seen.add(a.title);
      return true;
    });

    if (articleList.length === 0) {
      return [];
    }

    // 获取正文
    const result = [];
    const maxFetch = Math.min(articleList.length, this.config.max_articles);

    for (let i = 0; i < maxFetch; i++) {
      const article = articleList[i];
      console.log(`  → 获取正文 (${i + 1}/${maxFetch}): ${article.title.substring(0, 35)}...`);

      const detail = await this.fetchArticleContent(article.url);
      if (detail && detail.content.length > 100) {
        result.push({
          ...article,
          ...detail,
          title: detail.title || article.title
        });
      } else {
        console.log(`  ⚠ 正文过短，跳过`);
      }
    }


    return result;
  }

  /**
   * 使用 Tavily API 进行全网搜索
   * @param {string} query - 搜索关键词
   * @param {Object} options - 搜索选项 { maxResults: number, searchDepth: 'basic'|'advanced' }
   */
  async fetchWithTavily(query, options = {}) {
    if (!this.tavilyApiKey) {
      console.warn('  ⚠️ Tavily API key 未配置，跳过全网搜索');
      return [];
    }

    const maxResults = options.maxResults || 10;
    const searchDepth = options.searchDepth || 'basic';

    try {
      const response = await axios({
        method: 'post',
        url: 'https://api.tavily.com/search',
        timeout: 15000,
        headers: { 'Content-Type': 'application/json' },
        data: {
          api_key: this.tavilyApiKey,
          query: query,
          search_depth: searchDepth,
          max_results: maxResults,
          include_answer: false,
          include_raw_content: false,
          include_images: false,
        }
      });

      const results = response.data?.results || [];
      console.log(`  ✓ Tavily 全网搜索到 ${results.length} 条结果`);

      // 转换为标准格式
      return results.map(item => ({
        title: item.title || '',
        url: item.url || '',
        source: item.url?.split('/')[2] || 'Tavily',
        snippet: item.content || '',
        content: item.content || '',
        published_date: item.published_date || null,
      }));

    } catch (error) {
      console.error('  ✗ Tavily 搜索失败:', error.message);
      return [];
    }
  }
}

module.exports = NewsScraper;
