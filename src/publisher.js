'use strict';

/**
 * 微信公众号发布模块 v2
 * 修复：自动处理封面图 media_id
 *   - 优先使用 config.yaml 中配置的 default_thumb_media_id
 *   - 若未配置，则程序自动生成一张合规封面图上传，并把 media_id 缓存到本地
 *   - 后续发布直接复用缓存的 media_id，无需重复上传
 */

const _axiosModule = require('axios');
const axios = _axiosModule.default || _axiosModule;
const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

/**
 * 纯 Node.js 构造一张 300×300 纯色 PNG（无需任何第三方库）
 * 微信封面图要求：JPG/PNG，尺寸不小于 200×200，文件大小不超过 1MB
 */
function buildCoverPng(width = 300, height = 300) {
  // PNG 文件签名
  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  function crc32(buf) {
    let crc = 0xFFFFFFFF;
    const table = [];
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[i] = c;
    }
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function makeChunk(type, data) {
    const typeBuf = Buffer.from(type, 'ascii');
    const lenBuf  = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf  = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  }

  // IHDR：宽、高、位深8、RGB颜色类型2、压缩0、过滤0、非隔行0
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width,  0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8]  = 8;  // bit depth
  ihdr[9]  = 2;  // color type: RGB
  ihdr[10] = 0;  ihdr[11] = 0; ihdr[12] = 0;

  // IDAT：每行 = 过滤字节(0) + width*3 字节 RGB
  // 使用微信绿 #07C160 填充
  const R = 0x07, G = 0xC1, B = 0x60;
  const rawRows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    row[0] = 0; // filter type None
    for (let x = 0; x < width; x++) {
      row[1 + x * 3]     = R;
      row[1 + x * 3 + 1] = G;
      row[1 + x * 3 + 2] = B;
    }
    rawRows.push(row);
  }
  const raw = Buffer.concat(rawRows);
  const compressed = zlib.deflateSync(raw, { level: 6 });

  // IEND
  const iend = Buffer.alloc(0);

  return Buffer.concat([
    PNG_SIG,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', iend),
  ]);
}

// ─── 封面图 media_id 本地缓存路径 ─────────────────────────────
const DATA_DIR        = path.join(__dirname, '..', 'data');
const THUMB_CACHE     = path.join(DATA_DIR, 'thumb_media_id.json');

// ─── Markdown → 微信 HTML ────────────────────────────────────
function markdownToWeixinHtml(markdown) {
  let html = markdown;

  html = html.replace(/<!--[\s\S]*?-->/g, '');
  html = html.replace(/^### (.+)$/gm, '<h3 style="font-size:17px;font-weight:bold;margin:20px 0 8px;">$1</h3>');
  html = html.replace(/^## (.+)$/gm,  '<h2 style="font-size:20px;font-weight:bold;margin:24px 0 10px;border-left:4px solid #07C160;padding-left:10px;">$1</h2>');
  html = html.replace(/^# (.+)$/gm,   '<h1 style="font-size:24px;font-weight:bold;text-align:center;margin:20px 0;">$1</h1>');
  html = html.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid #eee;margin:20px 0;"/>');
  html = html.replace(/^> (.+)$/gm, '<blockquote style="background:#f5f5f5;border-left:4px solid #07C160;padding:10px 15px;margin:12px 0;color:#555;">$1</blockquote>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code style="background:#f0f0f0;padding:2px 5px;border-radius:3px;font-family:monospace;">$1</code>');
  html = html.replace(/^- (.+)$/gm, '<li style="margin:6px 0;">$1</li>');
  html = html.replace(/(<li[^>]*>[\s\S]*?<\/li>)+/g, '<ul style="padding-left:20px;margin:10px 0;">$&</ul>');
  html = html.replace(/^\d+\. (.+)$/gm, '<li style="margin:6px 0;">$1</li>');

  const lines = html.split('\n');
  const result = [];
  for (const line of lines) {
    const t = line.trim();
    if (t && !t.startsWith('<h') && !t.startsWith('<hr') && !t.startsWith('<ul') && !t.startsWith('<li') && !t.startsWith('<blockquote')) {
      result.push(`<p style="line-height:1.8;margin:12px 0;color:#333;">${t}</p>`);
    } else {
      result.push(line);
    }
  }
  html = result.join('\n');

  return `<section style="font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;font-size:16px;max-width:677px;margin:0 auto;padding:0 15px;">${html}</section>`;
}

class WeixinPublisher {
  constructor(config) {
    this.cfg       = config.weixin || {};
    this.appId     = this.cfg.app_id     || '';
    this.appSecret = this.cfg.app_secret || '';
    this._token       = null;
    this._tokenExpiry = 0;
  }

  // ── access_token（带缓存，Token文件复用）─────────────────────

  async getAccessToken() {
    if (this._token && Date.now() < this._tokenExpiry) return this._token;

    const res = await axios.get('https://api.weixin.qq.com/cgi-bin/token', {
      params: { grant_type: 'client_credential', appid: this.appId, secret: this.appSecret },
      timeout: 15000
    });

    if (res.data.errcode) {
      throw new Error(`获取 access_token 失败: [${res.data.errcode}] ${res.data.errmsg}`);
    }

    this._token = res.data.access_token;
    this._tokenExpiry = Date.now() + (res.data.expires_in - 300) * 1000;
    return this._token;
  }

  // ── 获取封面图 media_id（核心修复）───────────────────────────
  //
  //   优先级：
  //   1. config.yaml 中手动配置的 default_thumb_media_id
  //   2. 本地缓存文件 data/thumb_media_id.json
  //   3. 自动上传内置默认封面图，并写入缓存

  async getThumbMediaId() {
    // 1. 手动配置优先
    if (this.cfg.default_thumb_media_id && this.cfg.default_thumb_media_id.trim() !== '') {
      return this.cfg.default_thumb_media_id.trim();
    }

    // 2. 读本地缓存
    if (fs.existsSync(THUMB_CACHE)) {
      try {
        const cache = JSON.parse(fs.readFileSync(THUMB_CACHE, 'utf8'));
        if (cache.media_id) {
          console.log('  📎 使用已缓存的封面图 media_id');
          return cache.media_id;
        }
      } catch (e) { /* 缓存损坏，跳过 */ }
    }

    // 3. 上传内置默认封面图
    console.log('  🖼️  首次运行：自动上传默认封面图...');
    const mediaId = await this._uploadDefaultCover();

    // 写入缓存
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(THUMB_CACHE, JSON.stringify({ media_id: mediaId, uploaded_at: new Date().toISOString() }), 'utf8');
    console.log(`  ✓ 封面图已上传并缓存，media_id: ${mediaId}`);
    console.log('  💡 提示：如需自定义封面图，请将 media_id 填入 config.yaml 的 default_thumb_media_id');

    return mediaId;
  }

  // ── 上传内置默认封面图 ────────────────────────────────────────

  async _uploadDefaultCover() {
    const token  = await this.getAccessToken();
    // 生成 300×300 微信绿 PNG，符合微信封面图最低尺寸要求
    const imgBuf = buildCoverPng(300, 300);

    const mediaId = await this._doUploadPermanent(token, imgBuf, 'cover.png', 'image/png');
    return mediaId;
  }

  // ── 上传永久素材（内部通用方法）──────────────────────────────

  async _doUploadPermanent(token, imgBuf, filename, mime) {
    const boundary = `----WechatBoundary${Date.now()}`;
    const CRLF     = '\r\n';

    const header = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="media"; filename="${filename}"`,
      `Content-Type: ${mime}`,
      '',
      ''
    ].join(CRLF);

    const footer = `${CRLF}--${boundary}--${CRLF}`;
    const body   = Buffer.concat([Buffer.from(header, 'utf8'), imgBuf, Buffer.from(footer, 'utf8')]);

    const res = await axios.post(
      `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${token}&type=image`,
      body,
      {
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length
        },
        timeout: 30000
      }
    );

    if (res.data.errcode && res.data.errcode !== 0) {
      // 未认证订阅号不支持永久素材，降级为临时素材
      if (res.data.errcode === 48001 || res.data.errcode === 40001) {
        console.log('  ⚠️  账号不支持永久素材，改用临时素材（有效期3天）...');
        return await this._doUploadTemp(token, imgBuf, filename, mime);
      }
      throw new Error(`上传封面图失败: [${res.data.errcode}] ${res.data.errmsg}`);
    }

    return res.data.media_id;
  }

  // ── 上传临时素材（备用）──────────────────────────────────────

  async _doUploadTemp(token, imgBuf, filename, mime) {
    const boundary = `----WechatBoundary${Date.now()}`;
    const CRLF     = '\r\n';

    const header = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="media"; filename="${filename}"`,
      `Content-Type: ${mime}`,
      '',
      ''
    ].join(CRLF);

    const footer = `${CRLF}--${boundary}--${CRLF}`;
    const body   = Buffer.concat([Buffer.from(header), imgBuf, Buffer.from(footer)]);

    const res = await axios.post(
      `https://api.weixin.qq.com/cgi-bin/media/upload?access_token=${token}&type=image`,
      body,
      {
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length
        },
        timeout: 30000
      }
    );

    if (res.data.errcode && res.data.errcode !== 0) {
      throw new Error(`上传临时封面图失败: [${res.data.errcode}] ${res.data.errmsg}`);
    }

    return res.data.media_id;
  }

  // ── 新建草稿 ──────────────────────────────────────────────────

  async addDraft(article, thumbMediaId) {
    const token = await this.getAccessToken();

    // v3.0.2：支持 HTML 内容（包含图片）
    let htmlContent;
    if (this._isHtml(article.content)) {
      // 已是 HTML，处理图片并上传到微信
      console.log('  [草稿] 检测到 HTML 内容，处理图片...');
      htmlContent = await this._processHtmlWithImages(article.content, token);
    } else {
      // Markdown 内容，转换为微信 HTML
      htmlContent = markdownToWeixinHtml(article.content);
    }

    const digest = (article.summary || article.content)
      .replace(/\n/g, '').replace(/<[^>]+>/g, '').substring(0, 120);

    const body = {
      articles: [{
        title:               article.title,
        author:              this.cfg.author || '',
        digest,
        content:             htmlContent,
        content_source_url:  article.originalUrl || '',
        thumb_media_id:      thumbMediaId,
        need_open_comment:   this.cfg.open_comment ? 1 : 0,
        only_fans_can_comment: 0
      }]
    };

    const res = await axios.post(
      `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${token}`,
      body,
      { timeout: 20000 }
    );

    if (res.data.errcode && res.data.errcode !== 0) {
      throw new Error(`新建草稿失败: [${res.data.errcode}] ${res.data.errmsg}`);
    }

    return res.data.media_id;
  }

  // ── 判断是否为 HTML（v3.0.2 新增）─────────────────────────────

  _isHtml(content) {
    // 简单判断：包含 <img>、<p>、<div> 等标签
    return /<(img|p|div|h[1-6])\s/i.test(content);
  }

  // ── 处理 HTML 内容中的图片（v3.0.2 新增）───────────────────────

  async _processHtmlWithImages(html, token) {
    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    const imgMatches = [];
    let match;

    // 提取所有图片
    while ((match = imgRegex.exec(html)) !== null) {
      imgMatches.push({
        fullTag: match[0],
        src: match[1]
      });
    }

    if (imgMatches.length === 0) {
      console.log('  [草稿] 未找到图片，直接使用 HTML');
      return html;
    }

    console.log(`  [草稿] 找到 ${imgMatches.length} 张图片，开始上传到微信公众号...`);

    // 上传每张图片并替换 URL
    let processedHtml = html;
    for (let i = 0; i < imgMatches.length; i++) {
      const { fullTag, src } = imgMatches[i];
      try {
        console.log(`    [${i + 1}/${imgMatches.length}] 下载图片: ${src.substring(0, 50)}...`);

        // 下载图片
        const imgResponse = await axios.get(src, { responseType: 'arraybuffer', timeout: 30000 });
        const imgBuffer = Buffer.from(imgResponse.data);
        const contentType = imgResponse.headers['content-type'] || 'image/jpeg';
        const ext = contentType.includes('png') ? 'png' : 'jpg';
        const filename = `image_${Date.now()}_${i}.${ext}`;

        console.log(`    [${i + 1}/${imgMatches.length}] 下载完成（${imgBuffer.length} bytes），上传到微信...`);

        // 上传到微信公众号
        const mediaId = await this._uploadBufferToWeixin(imgBuffer, filename, contentType, token);

        console.log(`    [${i + 1}/${imgMatches.length}] 上传成功: ${mediaId}`);

        // 微信草稿接口支持 data-src 格式
        // <img data-src="media_id" ...>，微信会自动替换为正确的图片 URL
        // 保留原始属性（style, width, height 等），只替换 src 为 data-src
        const newTag = fullTag.replace(/src=["'][^"']+["']/, `data-src="${mediaId}"`);
        processedHtml = processedHtml.replace(fullTag, newTag);
      } catch (err) {
        console.error(`    [${i + 1}/${imgMatches.length}] 处理失败:`, err.message);
        // 失败时保留原图，继续处理下一张
      }
    }

    console.log('  [草稿] 所有图片处理完成');
    return processedHtml;
  }

  // ── 上传 Buffer 到微信公众号（v3.0.2 新增）─────────────────────

  async _uploadBufferToWeixin(buffer, filename, contentType, token) {
    const boundary = `----WechatBoundary${Date.now()}`;
    const CRLF = '\r\n';

    const header = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="media"; filename="${filename}"`,
      `Content-Type: ${contentType}`,
      '',
      ''
    ].join(CRLF);

    const footer = `${CRLF}--${boundary}--${CRLF}`;
    const body = Buffer.concat([Buffer.from(header, 'utf8'), buffer, Buffer.from(footer, 'utf8')]);

    // 先尝试永久素材
    try {
      const res = await axios.post(
        `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${token}&type=image`,
        body,
        {
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': body.length
          },
          timeout: 30000
        }
      );

      if (res.data.errcode && res.data.errcode !== 0) {
        // 降级为临时素材
        if (res.data.errcode === 48001 || res.data.errcode === 40001) {
          console.log('      降级为临时素材...');
          return await this._uploadTempBuffer(buffer, filename, contentType, token);
        }
        throw new Error(`上传图片失败: [${res.data.errcode}] ${res.data.errmsg}`);
      }

      return res.data.media_id;
    } catch (err) {
      // 降级为临时素材
      console.log('      降级为临时素材...');
      return await this._uploadTempBuffer(buffer, filename, contentType, token);
    }
  }

  // ── 上传临时 Buffer（v3.0.2 新增）──────────────────────────────

  async _uploadTempBuffer(buffer, filename, contentType, token) {
    const boundary = `----WechatBoundary${Date.now()}`;
    const CRLF = '\r\n';

    const header = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="media"; filename="${filename}"`,
      `Content-Type: ${contentType}`,
      '',
      ''
    ].join(CRLF);

    const footer = `${CRLF}--${boundary}--${CRLF}`;
    const body = Buffer.concat([Buffer.from(header, 'utf8'), buffer, Buffer.from(footer, 'utf8')]);

    const res = await axios.post(
      `https://api.weixin.qq.com/cgi-bin/media/upload?access_token=${token}&type=image`,
      body,
      {
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length
        },
        timeout: 30000
      }
    );

    if (res.data.errcode && res.data.errcode !== 0) {
      throw new Error(`上传临时图片失败: [${res.data.errcode}] ${res.data.errmsg}`);
    }

    return res.data.media_id;
  }

  // ── 提交发布 ──────────────────────────────────────────────────

  async submitPublish(mediaId) {
    const token = await this.getAccessToken();
    const res   = await axios.post(
      `https://api.weixin.qq.com/cgi-bin/freepublish/submit?access_token=${token}`,
      { media_id: mediaId },
      { timeout: 20000 }
    );

    if (res.data.errcode && res.data.errcode !== 0) {
      throw new Error(`提交发布失败: [${res.data.errcode}] ${res.data.errmsg}`);
    }

    return res.data.publish_id;
  }

  // ── 主入口 ────────────────────────────────────────────────────

  async publish(article, options = {}) {
    // 自动处理封面图
    let thumbMediaId;
    if (options.coverImagePath && fs.existsSync(options.coverImagePath)) {
      // 用户指定了本地封面图，直接上传
      console.log('  📷 上传指定封面图...');
      const token = await this.getAccessToken();
      thumbMediaId = await this._uploadLocalImage(options.coverImagePath, token);
    } else {
      // 自动获取（配置 → 缓存 → 自动上传）
      thumbMediaId = await this.getThumbMediaId();
    }

    // 新建草稿
    console.log('  📄 正在新建草稿...');
    const draftMediaId = await this.addDraft(article, thumbMediaId);
    console.log(`  ✓ 草稿创建成功`);

    // 按需提交发布
    if (options.publishDirectly) {
      console.log('  🚀 正在提交发布...');
      const publishId = await this.submitPublish(draftMediaId);
      return { draftMediaId, publishId, status: 'submitted' };
    }

    return { draftMediaId, status: 'draft' };
  }

  // ── 上传本地图片 ──────────────────────────────────────────────

  async _uploadLocalImage(imagePath, token) {
    const imgBuf  = fs.readFileSync(imagePath);
    const ext     = path.extname(imagePath).toLowerCase();
    const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
    const mime    = mimeMap[ext] || 'image/jpeg';
    return await this._doUploadPermanent(token, imgBuf, path.basename(imagePath), mime);
  }
}

module.exports = WeixinPublisher;
