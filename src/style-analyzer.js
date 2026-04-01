'use strict';

/**
 * 风格分析模块
 * 分析历史文章，提炼作者的写作风格档案（Style Profile）
 * 风格档案保存到 data/style_profile.json，每次写作时自动加载
 */

const _axiosModule = require('axios');
const axios = _axiosModule.default || _axiosModule;
const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STYLE_PROFILE_PATH = path.join(DATA_DIR, 'style_profile.json');

class StyleAnalyzer {
  constructor(config) {
    this.config = config;
    this.aiConfig = config.ai || {};
    this.provider = this.aiConfig.provider || 'deepseek';
    this._initClient();
  }

  _initClient() {
    const cfg = this.aiConfig[this.provider] || {};
    this.client = new OpenAI({
      apiKey: cfg.api_key || '',
      baseURL: cfg.api_base || 'https://api.deepseek.com/v1',
    });
    this.model = cfg.model || 'deepseek-chat';
    this.temperature = cfg.temperature || 0.3; // 分析任务用低温度，保证输出稳定
  }

  // ─── 主方法：分析样本文章，生成风格档案 ─────────────────────
  async analyze(samples, onProgress) {
    if (!samples || samples.length === 0) {
      throw new Error('没有找到历史文章样本，请先运行「同步历史文章」');
    }

    // 取最多15篇，每篇截取前800字（节省token）
    const usedSamples = samples.slice(0, 15).map((a, i) => ({
      index: i + 1,
      title: a.title,
      excerpt: a.content_text.substring(0, 800),
    }));

    if (onProgress) onProgress('正在分析文章样本，提炼写作风格...');

    const samplesText = usedSamples.map(s =>
      `【第${s.index}篇】标题：${s.title}\n正文节选：\n${s.excerpt}\n`
    ).join('\n---\n');

    // ── 分段分析策略：把复杂 JSON 拆成 3 次简单请求，彻底规避格式问题 ──
    const systemMsg = '你是专业的文学风格分析师。请根据给定的文章样本，精准分析作者写作风格。';
    const articleContext = `以下是来自同一位公众号作者的 ${usedSamples.length} 篇文章节选：\n\n${samplesText}`;

    // 第一步：分析基础属性（用简单键值对，不嵌套）
    if (onProgress) onProgress('Step 1/3：分析语气、结构、语言特征...');
    const part1 = await this._askFlat(systemMsg, articleContext, `
请分析这位作者的写作风格，用以下格式逐行输出，每行一个字段，格式为 字段名: 值，不要输出任何其他内容：

summary: （50字以内总结作者风格，生动具体）
tone_description: （语气整体描述）
tone_formality: （正式/半正式/口语化，三选一）
tone_emotion: （克制/饱满/激情/冷静，四选一）
perspective_viewpoint: （第一人称/第三人称/混用，三选一）
perspective_stance: （观点鲜明/中立/批判性，三选一）
perspective_style: （评论型/叙事型/分析型/科普型，四选一）
structure_opening: （开篇方式，如：直接抛出观点、以故事引入、以问题开场）
structure_body: （正文逻辑，如：总分总、时间线、问题-分析-结论）
structure_closing: （结尾方式，如：升华主题、反问读者、呼吁行动）
structure_paragraph: （短小精悍/中等/长篇大论，三选一）
vocabulary_level: （通俗/专业/雅俗共赏，三选一）
sentence_length: （短句为主/长短结合/长句为主，三选一）
content_depth: （浅层科普/有一定深度/深度剖析，三选一）
content_data: （大量数据/适当数据/几乎不用数据，三选一）
content_example: （用真实案例/用假设举例/用历史典故，三选一）`);

    // 第二步：分析数组类字段（主题、修辞、标志表达）
    if (onProgress) onProgress('Step 2/3：提炼标志性表达和主题...');
    const part2 = await this._askFlat(systemMsg, articleContext, `
请分析这位作者的写作风格，用以下格式逐行输出，每行一个字段，格式为 字段名: 值1|值2|值3（多个值用|分隔），不要输出任何其他内容：

tone_keywords: （3个形容词，描述语气关键词，用|分隔）
rhetorical_devices: （2-3个常用修辞手法，用|分隔）
signature_expressions: （3-5个作者标志性习惯用语或表达，直接从文章中摘取，用|分隔）
avoid_expressions: （1-2个作者几乎不用的表达风格，用|分隔）
content_themes: （3个作者常写的主题，用|分隔）
sample_sentences: （从原文直接摘取3-4句最能代表作者风格的句子，用|分隔）`);

    // 第三步：生成写作指令（纯文本，最不容易出格式问题）
    if (onProgress) onProgress('Step 3/3：生成AI写作指令...');
    const instrResp = await this.client.chat.completions.create({
      model: this.model,
      temperature: this.temperature,
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user', content: `${articleContext}\n\n请为AI写一段写作指令（200字以内），用第二人称"你"写，告诉AI如何模仿这位作者的风格写作。包括：开篇怎么写、论点怎么展开、语气怎么把控、结尾怎么收。直接输出指令文字，不要任何格式标记。` }
      ],
    });
    const writing_instructions = instrResp.choices[0].message.content.trim();

    // ── 组装风格档案 ───────────────────────────────────────────
    const profile = {
      summary:     part1.summary     || '',
      tone: {
        description: part1.tone_description || '',
        keywords:    this._splitArr(part2.tone_keywords),
        formality:   part1.tone_formality   || '',
        emotion:     part1.tone_emotion     || '',
      },
      perspective: {
        viewpoint: part1.perspective_viewpoint || '',
        stance:    part1.perspective_stance    || '',
        style:     part1.perspective_style     || '',
      },
      structure: {
        opening_style:    part1.structure_opening    || '',
        body_logic:       part1.structure_body       || '',
        closing_style:    part1.structure_closing    || '',
        paragraph_length: part1.structure_paragraph  || '',
      },
      language: {
        vocabulary_level:     part1.vocabulary_level              || '',
        sentence_length:      part1.sentence_length               || '',
        rhetorical_devices:   this._splitArr(part2.rhetorical_devices),
        signature_expressions:this._splitArr(part2.signature_expressions),
        avoid_expressions:    this._splitArr(part2.avoid_expressions),
      },
      content: {
        themes:        this._splitArr(part2.content_themes),
        depth:         part1.content_depth   || '',
        data_usage:    part1.content_data    || '',
        example_style: part1.content_example || '',
      },
      writing_instructions,
      sample_sentences: this._splitArr(part2.sample_sentences),
      _meta: {
        analyzed_at:  new Date().toISOString(),
        sample_count: usedSamples.length,
        provider:     this.provider,
        model:        this.model,
      },
    };

    // 保存到本地
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STYLE_PROFILE_PATH, JSON.stringify(profile, null, 2), 'utf8');

    return profile;
  }

  // ─── 发送扁平键值对请求，返回解析后的对象 ─────────────────────
  async _askFlat(systemMsg, context, question) {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      temperature: this.temperature,
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user', content: `${context}\n\n${question}` }
      ],
    });

    const raw = completion.choices[0].message.content.trim();
    const result = {};

    // 逐行解析 "key: value" 格式
    for (const line of raw.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const key = line.substring(0, colonIdx).trim().replace(/[^a-z_]/gi, '');
      const val = line.substring(colonIdx + 1).trim();
      if (key && val) result[key] = val;
    }

    return result;
  }

  // ─── 将 "a|b|c" 或 "a、b、c" 拆成数组 ──────────────────────
  _splitArr(str) {
    if (!str) return [];
    return str.split(/[|｜、,，]/).map(s => s.trim()).filter(Boolean);
  }

  // ─── 加载已有风格档案 ─────────────────────────────────────────
  loadProfile() {
    if (!fs.existsSync(STYLE_PROFILE_PATH)) return null;
    try {
      return JSON.parse(fs.readFileSync(STYLE_PROFILE_PATH, 'utf8'));
    } catch (e) {
      return null;
    }
  }

  // ─── 将风格档案转换为写作 Prompt 片段 ────────────────────────
  profileToPrompt(profile, referenceArticles = []) {
    if (!profile) return '';

    const lines = [];

    lines.push(`## 作者风格档案`);
    lines.push(`**风格概述**：${profile.summary}`);
    lines.push('');

    if (profile.tone) {
      lines.push(`**语气特征**：${profile.tone.description}，关键词：${(profile.tone.keywords || []).join('、')}，语气${profile.tone.emotion}`);
    }

    if (profile.perspective) {
      lines.push(`**观点立场**：${profile.perspective.stance}，文章类型：${profile.perspective.style}`);
    }

    if (profile.structure) {
      lines.push(`**文章结构**：开篇${profile.structure.opening_style}，${profile.structure.body_logic}，结尾${profile.structure.closing_style}`);
    }

    if (profile.language) {
      if (profile.language.signature_expressions && profile.language.signature_expressions.length) {
        lines.push(`**标志性表达**：${profile.language.signature_expressions.join('；')}`);
      }
    }

    if (profile.writing_instructions) {
      lines.push('');
      lines.push(`## 核心写作指令`);
      lines.push(profile.writing_instructions);
    }

    if (profile.sample_sentences && profile.sample_sentences.length) {
      lines.push('');
      lines.push(`## 风格参考句（请体会语感）`);
      profile.sample_sentences.forEach((s, i) => {
        lines.push(`${i + 1}. "${s}"`);
      });
    }

    // 附上相似历史文章作为参考
    if (referenceArticles && referenceArticles.length > 0) {
      lines.push('');
      lines.push(`## 作者同类文章参考（${referenceArticles.length}篇）`);
      referenceArticles.forEach((a, i) => {
        const excerpt = a.content_text
          ? a.content_text.substring(0, 600)
          : (a.digest || '');
        lines.push(`\n### 参考${i + 1}：《${a.title}》`);
        lines.push(excerpt + (a.content_text && a.content_text.length > 600 ? '……' : ''));
      });
    }

    return lines.join('\n');
  }

  // ─── 打印风格档案摘要（控制台展示用）────────────────────────
  printProfileSummary(profile) {
    if (!profile) {
      console.log('  ⚠️  尚未建立风格档案，请先运行「分析写作风格」');
      return;
    }
    console.log(`\n  📝 风格概述：${profile.summary}`);
    if (profile.tone) {
      console.log(`  🎙️  语气：${profile.tone.keywords?.join('、')}`);
    }
    if (profile.perspective) {
      console.log(`  🔭 立场：${profile.perspective.stance} / ${profile.perspective.style}`);
    }
    if (profile._meta) {
      console.log(`  📅 分析时间：${profile._meta.analyzed_at?.substring(0, 10)}，样本量：${profile._meta.sample_count} 篇`);
    }
  }
}

module.exports = StyleAnalyzer;
