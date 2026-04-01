'use strict';

/**
 * 历史文章同步模块
 * 通过微信公众号官方 API 拉取全量历史文章，保存到本地 JSON 数据库
 *
 * 微信 API 说明：
 *   - 获取图文素材列表：POST /cgi-bin/material/batchgetmaterial（全账号通用）
 *     type=news，每页最多 20 条，分页循环拉取
 *   - freepublish 系列接口仅认证服务号可用，普通订阅号会报 40066，不使用
 */

const _axiosModule = require('axios');
const axios = _axiosModule.default || _axiosModule;
const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, '..', 'data');
const ARTICLES_DB = path.join(DB_DIR, 'articles.json');
const TOKEN_CACHE = path.join(DB_DIR, 'token_cache.json');

class HistorySync {
  constructor(config) {
    this.config = config;
    this.wxConfig = config.weixin || {};
    this.appId = this.wxConfig.app_id;
    this.appSecret = this.wxConfig.app_secret;
    this._ensureDataDir();
  }

  _ensureDataDir() {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
  }

  // ─── 获取 Access Token（带缓存，避免频繁请求）────────────────
  async getAccessToken() {
    // 读取缓存
    if (fs.existsSync(TOKEN_CACHE)) {
      try {
        const cache = JSON.parse(fs.readFileSync(TOKEN_CACHE, 'utf8'));
        // 提前 5 分钟过期
        if (cache.expires_at && Date.now() < cache.expires_at - 300000) {
          return cache.access_token;
        }
      } catch (e) { /* 缓存损坏，重新获取 */ }
    }

    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${this.appId}&secret=${this.appSecret}`;
    const res = await axios.get(url, { timeout: 10000 });
    const data = res.data;

    if (!data.access_token) {
      const msg = this._friendlyError(data.errcode, data.errmsg);
      throw new Error(msg);
    }

    // 写入缓存
    fs.writeFileSync(TOKEN_CACHE, JSON.stringify({
      access_token: data.access_token,
      expires_at: Date.now() + data.expires_in * 1000
    }), 'utf8');

    return data.access_token;
  }

  _friendlyError(errcode, errmsg) {
    const map = {
      40164: `IP 不在白名单！请将你的公网 IP 加入公众平台「基本配置」→「IP白名单」`,
      40013: `AppID 不合法，请检查 config.yaml 中的 weixin.app_id`,
      40125: `AppSecret 错误，请在公众平台重置后重新填写`,
      40001: `access_token 失效，请重新运行`,
      40066: `账号无权限调用此接口（未认证订阅号限制），请使用「手动导入文章」功能`,
      48001: `接口未授权，该账号类型不支持此功能`,
    };
    return map[errcode] || `微信API错误 ${errcode}: ${errmsg}`;
  }

  // ─── 拉取永久图文素材列表（所有账号通用）─────────────────────
  // 接口：POST /cgi-bin/material/batchgetmaterial，type=news
  async fetchMaterialArticles(token, onProgress) {
    const articles = [];
    let offset = 0;
    const count = 20;
    let total = null;

    while (true) {
      const url = `https://api.weixin.qq.com/cgi-bin/material/batchgetmaterial?access_token=${token}`;
      const res = await axios.post(url, { type: 'news', offset, count }, { timeout: 15000 });
      const data = res.data;

      if (data.errcode && data.errcode !== 0) {
        throw new Error(this._friendlyError(data.errcode, data.errmsg));
      }

      if (total === null) total = data.total_count || 0;

      const items = data.item || [];
      if (items.length === 0) break;

      // 每个 item 是一个图文素材，content.news_item 包含 1~8 篇文章
      for (const material of items) {
        const newsItems = (material.content && material.content.news_item) || [];
        for (const article of newsItems) {
          articles.push({
            article_id: material.media_id || '',
            title:       article.title        || '',
            author:      article.author       || '',
            digest:      article.digest       || '',
            content:     article.content      || '',
            content_source_url: article.content_source_url || '',
            url:         article.url          || '',
            thumb_url:   article.thumb_url    || '',
            publish_time: material.update_time || 0,
            update_time:  article.update_time  || 0,
          });
        }
      }

      if (onProgress) {
        onProgress(Math.min(articles.length, total), total);
      }

      offset += items.length;
      if (offset >= total || items.length < count) break;

      await this._sleep(500);
    }

    return articles;
  }

  // ─── 拉取草稿箱文章（补充来源）────────────────────────────────
  // 接口：POST /cgi-bin/draft/batchget，所有账号通用
  async fetchDraftArticles(token) {
    const articles = [];
    let offset = 0;
    const count = 20;
    let total = null;

    while (true) {
      const url = `https://api.weixin.qq.com/cgi-bin/draft/batchget?access_token=${token}`;
      const res = await axios.post(url, { offset, count, no_content: 0 }, { timeout: 15000 });
      const data = res.data;

      // 草稿箱报错不中断，直接跳过
      if (data.errcode && data.errcode !== 0) break;

      if (total === null) total = data.total_count || 0;

      const items = data.item || [];
      if (items.length === 0) break;

      for (const draft of items) {
        const newsItems = (draft.content && draft.content.news_item) || [];
        for (const article of newsItems) {
          articles.push({
            article_id:  draft.media_id        || '',
            title:       article.title          || '',
            author:      article.author         || '',
            digest:      article.digest         || '',
            content:     article.content        || '',
            content_source_url: article.content_source_url || '',
            url:         '',
            thumb_url:   article.thumb_url      || '',
            publish_time: draft.update_time     || 0,
            update_time:  article.update_time   || 0,
            is_draft:    true,
          });
        }
      }

      offset += items.length;
      if (offset >= total || items.length < count) break;
      await this._sleep(500);
    }

    return articles;
  }

  // ─── 主同步方法：拉取 + 保存 ─────────────────────────────────
  async sync(onProgress) {
    const token = await this.getAccessToken();

    // 1. 拉取永久图文素材（主要来源）
    let materialArticles = [];
    try {
      materialArticles = await this.fetchMaterialArticles(token, onProgress);
      console.log(`\n  ✓ 永久素材中找到 ${materialArticles.length} 篇图文`);
    } catch (e) {
      if (e.message.includes('40066') || e.message.includes('48001')) {
        // 抛出特殊标记，让调用方处理降级
        throw Object.assign(new Error('NEED_MANUAL_IMPORT'), { code: 'NEED_MANUAL_IMPORT' });
      }
      throw e;
    }

    // 2. 拉取草稿箱（补充来源，失败不影响主流程）
    let draftArticles = [];
    try {
      draftArticles = await this.fetchDraftArticles(token);
      if (draftArticles.length > 0) {
        console.log(`  ✓ 草稿箱中找到 ${draftArticles.length} 篇图文`);
      }
    } catch (e) { /* 草稿箱拉取失败忽略 */ }

    // 3. 合并去重（按 title 去重）
    const seen = new Set();
    const allArticles = [...materialArticles, ...draftArticles].filter(a => {
      if (!a.title || seen.has(a.title)) return false;
      seen.add(a.title);
      return true;
    });

    return this._saveArticles(allArticles);
  }

  // ─── 手动导入：从本地 TXT/MD 文件批量导入 ─────────────────────
  // 用法：把你的历史文章内容逐篇保存为 data/import/ 目录下的 .txt 或 .md 文件
  // 文件名即标题，文件内容即正文
  importFromFiles() {
    const importDir = path.join(DB_DIR, 'import');
    if (!fs.existsSync(importDir)) {
      fs.mkdirSync(importDir, { recursive: true });
    }

    const files = fs.readdirSync(importDir)
      .filter(f => f.endsWith('.txt') || f.endsWith('.md'));

    if (files.length === 0) return [];

    const articles = files.map((filename, i) => {
      const title   = path.basename(filename, path.extname(filename));
      const content = fs.readFileSync(path.join(importDir, filename), 'utf8');
      return {
        article_id:   `local_${i}`,
        title,
        author:       '',
        digest:       content.replace(/\s+/g, ' ').substring(0, 100),
        content,
        content_text: content,
        word_count:   content.replace(/\s/g, '').length,
        publish_time: 0,
        update_time:  0,
        is_local:     true,
      };
    });

    return this._saveArticles(articles);
  }

  // ─── 保存文章到本地数据库（内部公共方法）─────────────────────
  _saveArticles(allArticles) {
    const cleaned = allArticles.map(a => ({
      ...a,
      content_text: a.content_text || this._stripHtml(a.content),
      word_count:   a.word_count   || this._stripHtml(a.content).replace(/\s/g, '').length,
    }));

    cleaned.sort((a, b) => b.publish_time - a.publish_time);

    const db = {
      synced_at: new Date().toISOString(),
      total:     cleaned.length,
      articles:  cleaned,
    };
    fs.writeFileSync(ARTICLES_DB, JSON.stringify(db, null, 2), 'utf8');
    return cleaned;
  }

  // ─── 读取本地数据库 ──────────────────────────────────────────
  loadLocal() {
    if (!fs.existsSync(ARTICLES_DB)) return null;
    try {
      const db = JSON.parse(fs.readFileSync(ARTICLES_DB, 'utf8'));
      return db;
    } catch (e) {
      return null;
    }
  }

  // ─── 智能检索相似文章（基于关键词匹配）──────────────────────
  findSimilar(keyword, topN = 3) {
    const db = this.loadLocal();
    if (!db || !db.articles.length) return [];

    const kw = keyword.toLowerCase();
    const keywords = kw.split(/[\s，,、]+/).filter(k => k.length > 1);

    // 计算每篇文章的相关性得分
    const scored = db.articles
      .filter(a => a.content_text && a.content_text.length > 100)
      .map(a => {
        let score = 0;
        const text = (a.title + a.digest + a.content_text).toLowerCase();
        for (const kw of keywords) {
          // 标题命中权重更高
          const titleHits = (a.title.toLowerCase().match(new RegExp(kw, 'g')) || []).length;
          const bodyHits = (text.match(new RegExp(kw, 'g')) || []).length;
          score += titleHits * 3 + bodyHits;
        }
        return { ...a, score };
      })
      .filter(a => a.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);

    return scored;
  }

  // ─── 获取用于风格分析的样本（最新N篇，且正文足够长）────────
  getSamples(n = 15) {
    const db = this.loadLocal();
    if (!db) return [];
    return db.articles
      .filter(a => a.content_text && a.word_count >= 300)
      .slice(0, n);
  }

  // ─── 工具方法 ─────────────────────────────────────────────────
  _stripHtml(html) {
    if (!html) return '';
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = HistorySync;
