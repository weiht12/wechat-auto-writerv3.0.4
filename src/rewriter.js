/**
 * AI 改写模块
 * 支持 DeepSeek、通义千问、文心一言、硅基流动（SiliconFlow）
 * 核心功能：多篇文章聚合融合改写 → 输出一篇高质量原创文章
 *
 * v2.9.8+：智能模型路由 + 自动降级熔断（SiliconFlow 专属）
 */

'use strict';

const { OpenAI } = require('openai');
const _axiosModule = require('axios');
const axios = _axiosModule.default || _axiosModule;

// ══════════════════════════════════════════════════════════
// 硅基流动智能模型路由配置
// ══════════════════════════════════════════════════════════
const SF_ROUTE = {
  // 主模型：文本创作（改写、原创、扩写）——V3.1 混合推理，支持思考模式
  creative:  'deepseek-ai/DeepSeek-V3',
  // 推理模型：政策分析、规划类、逻辑推理
  reasoning: 'deepseek-ai/DeepSeek-R1',
  // 文采模型：豫事堂风格、散文风格（Qwen 文学底蕴更深）
  literary:  'Qwen/Qwen2.5-72B-Instruct',
  // 降级备选：主模型繁忙时自动切换（用 Pro 保证稳定性）
  fallback:  'Pro/Qwen/Qwen2.5-7B-Instruct',
};

/**
 * 根据任务内容和风格参数，自动选择最合适的硅基流动文本模型
 * @param {string} prompt  - AI 请求 prompt 内容（用于关键词检测）
 * @param {string} styleChip - 风格参数（yushtang / news / depth / interact / none / custom / ref）
 * @param {string} configModel - config.yaml 中设置的默认模型
 * @returns {string} 模型 ID
 */
function _autoSelectSFModel(prompt, styleChip, configModel) {
  // 豫事堂 / 散文风格 → Qwen（文学底蕴更深）
  if (styleChip === 'yushtang') {
    return SF_ROUTE.literary;
  }

  // 深度分析风格 → DeepSeek-R1（逻辑推理强）
  if (styleChip === 'depth') {
    return SF_ROUTE.reasoning;
  }

  // Prompt 内容关键词检测
  if (prompt) {
    const p = prompt.toLowerCase();
    // 政策分析、规划、推理类任务 → R1
    if (/政策|规划|升学|为什么|如何分析|深度分析|逻辑|推理|研究报告/.test(p)) {
      return SF_ROUTE.reasoning;
    }
    // 散文、文学风格 → Qwen
    if (/散文|文学|优美|诗意|文采/.test(p)) {
      return SF_ROUTE.literary;
    }
  }

  // 其余（改写、原创、新闻类）→ 优先用 config 中设置的模型，其次 DeepSeek-V3
  return configModel || SF_ROUTE.creative;
}


class AIRewriter {
  constructor(config) {
    this.config = config.ai;
    this.rewriteConfig = config.rewrite;
    this.client = null;
    this.wenxinToken = null;
    this.stylePrompt = '';      // 风格档案 Prompt 片段（外部注入）
    this.customDirection = {};   // 用户自定义方向和大纲
    this.deepResearchResult = ''; // 深度研究结果
    this.enableStyleProfile = true; // 是否启用风格档案（默认启用）
    this._initClient();
  }

  /**
   * 注入风格档案（由主程序调用，在改写前设置）
   * @param {string} stylePromptText - 由 StyleAnalyzer.profileToPrompt() 生成的文本
   */
  setStylePrompt(stylePromptText) {
    this.stylePrompt = stylePromptText || '';
  }

  /**
   * 设置是否启用风格档案
   * @param {boolean} enable - true 启用，false 禁用
   */
  setStyleProfileEnabled(enable) {
    this.enableStyleProfile = enable;
  }

  /**
   * 注入用户自定义写作方向和大纲
   * @param {Object} custom - { direction?: string, outline?: string }
   */
  setCustomDirection(custom) {
    this.customDirection = custom || {};
  }

  /**
   * 执行 Tavily 深度研究
   * @param {string} topic - 研究主题
   * @returns {string} - 研究结果文本
   */
  async conductDeepResearch(topic) {
    const apiKey = this.config.tavily?.api_key || process.env.TAVILY_API_KEY || '';
    if (!apiKey) {
      console.log('  ⚠️ Tavily API key 未配置，跳过深度研究');
      return '';
    }

    try {
      const axios = require('axios');
      const response = await axios({
        method: 'post',
        url: 'https://api.tavily.com/search',
        timeout: 20000,
        headers: { 'Content-Type': 'application/json' },
        data: {
          api_key: apiKey,
          query: topic,
          search_depth: 'advanced',
          max_results: 10,
          include_answer: true,
          include_raw_content: false,
          include_images: false,
        }
      });

      const answer = response.data?.answer || '';
      const results = response.data?.results || [];

      let researchText = `## 深度研究成果：${topic}\n\n`;
      if (answer) {
        researchText += `### AI 总结\n${answer}\n\n`;
      }

      researchText += `### 参考资料\n`;
      results.forEach((item, i) => {
        researchText += `\n${i + 1}. ${item.title}\n   ${item.url}\n   ${item.content?.substring(0, 150) || ''}...\n`;
      });

      console.log(`  ✓ 深度研究完成，获取 ${results.length} 条参考资料`);
      return researchText;

    } catch (error) {
      console.error('  ✗ 深度研究失败:', error.message);
      return '';
    }
  }

  // ── 初始化客户端 ────────────────────────────────────────────

  _initClient() {
    const provider = this.config.provider;
    if (provider === 'deepseek') {
      this.client = new OpenAI({
        apiKey: this.config.deepseek.api_key,
        baseURL: this.config.deepseek.api_base
      });
    } else if (provider === 'tongyi') {
      this.client = new OpenAI({
        apiKey: this.config.tongyi.api_key,
        baseURL: this.config.tongyi.api_base
      });
    } else if (provider === 'siliconflow') {
      // v2.9.8+：硅基流动改用 axios 直接调用，确保 Bearer 格式、支持智能路由和降级
      // client 设为 null，由 _callSiliconFlow 处理
      this.client = null;
    }
  }


  // ── 风格描述 ────────────────────────────────────────────────

  _getStylePrompt() {
    const styles = {
      professional: '专业严谨、逻辑清晰、措辞准确，适合知识型读者',
      casual: '轻松活泼、接地气、口语化，像朋友聊天一样',
      storytelling: '故事化叙事，有场景感，引人入胜，情感丰富',
      analytical: '深度分析，有数据有观点，提供独特洞见'
    };
    return styles[this.rewriteConfig.style] || styles.professional;
  }

  // ── 构建【多篇聚合】Prompt ──────────────────────────────────

  /**
   * 将 N 篇文章的内容拼装成一个聚合 Prompt
   * 如果已注入风格档案（stylePrompt），则将其嵌入 Prompt 中
   * @param {Array} articles - 文章数组
   */
  _buildMergePrompt(articles) {
    const style = this._getStylePrompt();
    const targetWords = this.rewriteConfig.target_words;
    const count = articles.length;
    const hasStyleProfile = !!this.stylePrompt && this.enableStyleProfile;
    const custom = this.customDirection || {};
    const hasCustomDirection = custom.direction || custom.outline;

    // 有风格档案时，为风格和参考文章留更多空间，压缩单篇素材
    const perArticleLimit = Math.floor((hasStyleProfile ? 3500 : 5500) / count);

    const materialSection = articles.map((a, i) => {
      const contentSnippet = a.content.substring(0, perArticleLimit);
      return `### 素材 ${i + 1}：${a.title}\n**来源**：${a.source || '未知'}\n\n${contentSnippet}`;
    }).join('\n\n---\n\n');

    const titleList = articles.map((a, i) => `${i + 1}. ${a.title}`).join('\n');

    const systemRole = hasStyleProfile
      ? `你是一位专业的代笔写手，你的任务是完全模仿指定作者的风格，将多篇新闻素材改写为该作者风格的公众号文章。`
      : `你是一位专业的微信公众号主编，擅长将多篇新闻素材深度融合，撰写出观点独到、内容丰富的原创文章。`;

    // 用户自定义写作方向和大纲部分（高优先级）
    const customDirectionSection = hasCustomDirection
      ? `\n## 📝 用户自定义写作方向 ⚠️ 最高优先级\n\n${custom.direction ? `### 写作方向\n${custom.direction}\n\n` : ''}\n${custom.outline ? `### 文章大纲\n${custom.outline}\n\n` : ''}\n**🔴 关键要求**：上方用户指定的写作方向和大纲是最高优先级指令，你必须严格遵守！\n- 必须严格按照大纲展开文章结构\n- 每个章节都必须详细展开，不得遗漏\n- 写作方向决定了文章的立场、角度和重点\n- 即使这与素材内容不完全一致，也要优先遵循用户的方向和大纲\n\n`
      : '';

    // 风格档案部分（次优先级，且可禁用）
    const styleSection = hasStyleProfile
      ? `\n${this.stylePrompt}\n\n⚠️ **风格要求**：在遵循上方用户自定义方向和大纲的前提下，模仿该作者的语气和表达习惯。**注意：风格模仿是次要的，方向和大纲执行是首要的。**\n`
      : `\n## 写作风格\n- **风格**：${style}\n`;

    // 深度研究结果部分
    const deepResearchSection = this.deepResearchResult
      ? `\n${this.deepResearchResult}\n\n⚠️ **参考资料**：请充分利用上述深度研究获取的参考资料，在文章中融入相关的数据、案例和专家观点。`
      : '';

    return `${systemRole}

## 任务
我给你提供了 ${count} 篇关于同一话题的新闻素材，请你：
1. 综合提炼各篇的核心信息、关键数据和不同视角
2. 去除重复内容，补充逻辑衔接
3. 融合改写成一篇完整的微信公众号原创文章
${styleSection}
${customDirectionSection}
${deepResearchSection}
## 新闻素材标题概览
${titleList}

## 其他写作要求
- **字数**：约 ${targetWords} 字
- **融合深度**：不是简单拼接，而是提炼每篇精华后重新构建叙事逻辑
- **原创度**：完全重新组织语言，禁止直接复制任何原文句子
- **结构**：有引言、2~4 个小节（各有 ## 标题）、结尾
${this.rewriteConfig.add_summary ? '- **导读**：文章开头写一段不超过 80 字的导读摘要' : ''}
${this.rewriteConfig.add_ending ? '- **结尾互动**：最后一句话引导读者点赞/留言/转发' : ''}

## 输出格式（严格遵守，不要输出任何格式之外的说明文字）

---TITLE---
（重新拟定一个吸引人的标题，不超过 25 字）

---SUMMARY---
（导读摘要）

---CONTENT---
（正文，Markdown 格式，使用 ## 二级标题分节）

---TAGS---
（3~5 个话题标签，英文逗号分隔，如：科技,人工智能,创新）

---END---

## 新闻原始素材
${materialSection}
`;
  }

  // ── 构建【单篇改写】Prompt ──────────────────────────────────

  _buildSinglePrompt(article) {
    const style = this._getStylePrompt();
    const targetWords = this.rewriteConfig.target_words;
    const hasStyleProfile = !!this.stylePrompt && this.enableStyleProfile;
    const custom = this.customDirection || {};
    const hasCustomDirection = custom.direction || custom.outline;

    // 用户自定义写作方向和大纲部分（最高优先级）
    const customDirectionSection = hasCustomDirection
      ? `\n## 📝 用户自定义写作方向 ⚠️ 最高优先级\n\n${custom.direction ? `### 写作方向\n${custom.direction}\n\n` : ''}\n${custom.outline ? `### 文章大纲\n${custom.outline}\n\n` : ''}\n**🔴 关键要求**：上方用户指定的写作方向和大纲是最高优先级指令，你必须严格遵守！\n- 必须严格按照大纲展开文章结构\n- 每个章节都必须详细展开，不得遗漏\n- 写作方向决定了文章的立场、角度和重点\n- 即使这与素材内容不完全一致，也要优先遵循用户的方向和大纲\n\n`
      : '';

    // 风格档案部分（次优先级，且可禁用）
    const styleSection = hasStyleProfile
      ? `\n${this.stylePrompt}\n\n⚠️ **风格要求**：在遵循上方用户自定义方向和大纲的前提下，模仿该作者的语气和表达习惯。**注意：风格模仿是次要的，方向和大纲执行是首要的。**\n`
      : `\n## 写作风格\n- **风格**：${style}\n`;

    // 深度研究结果部分
    const deepResearchSection = this.deepResearchResult
      ? `\n${this.deepResearchResult}\n\n⚠️ **参考资料**：请充分利用上述深度研究获取的参考资料，在文章中融入相关的数据、案例和专家观点。`
      : '';

    return `你是一位专业的微信公众号${hasStyleProfile ? '代笔写手，你的任务是完全模仿指定作者的风格写作' : '编辑，擅长将新闻内容改写成高质量的原创文章'}。
${styleSection}
${customDirectionSection}
${deepResearchSection}
## 其他写作要求
- **字数**：约 ${targetWords} 字
- **原创度**：完全重新组织语言，不能直接复制原文句子
- **结构**：有清晰的段落结构，逻辑流畅，使用 ## 二级标题分节
${this.rewriteConfig.add_summary ? '- **导读**：在文章开头写一段不超过 80 字的导读摘要' : ''}
${this.rewriteConfig.add_ending ? '- **结尾**：加一句互动引导语，鼓励读者点赞/留言' : ''}

## 输出格式（严格遵守）

---TITLE---
（文章标题）

---SUMMARY---
（导读摘要）

---CONTENT---
（正文，Markdown 格式）

---TAGS---
（3~5 个话题标签，英文逗号分隔）

---END---

## 原始素材
**标题**：${article.title}

**正文**：
${article.content.substring(0, 5000)}
`;
  }

  // ── AI 调用层 ───────────────────────────────────────────────

  async _callOpenAICompatible(prompt) {
    const provider    = this.config.provider;
    const modelConfig = this.config[provider];
    const hasStyleProfile = !!this.stylePrompt;
    const maxRetries  = 3;
    const retryDelay  = 2000; // 2 秒

    // 主引擎重试
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model: modelConfig.model,
          messages: [
            {
              role: 'system',
              content: hasStyleProfile
                ? '你是一位专业的代笔写手，你的首要任务是精准模仿指定作者的写作风格，包括语气、句式和叙述习惯，输出高质量原创公众号文章。'
                : '你是一位资深的微信公众号主编，擅长多素材融合改写，输出高质量、高原创度的公众号文章。'
            },
            { role: 'user', content: prompt }
          ],
          temperature: modelConfig.temperature,
          max_tokens: modelConfig.max_tokens
        });

        return response.choices[0].message.content;

      } catch (error) {
        lastError = error;
        console.error(`  ✗ AI 调用失败 (尝试 ${attempt}/${maxRetries}):`, error.message);

        // 检查是否是可重试的错误
        const isRetryable = error.code === 'ECONNRESET' ||
                          error.code === 'ECONNREFUSED' ||
                          error.code === 'ETIMEDOUT' ||
                          error.code === 'ENOTFOUND' ||
                          error.message?.includes('timeout') ||
                          error.message?.includes('reset') ||
                          error.status >= 500;

        if (isRetryable && attempt < maxRetries) {
          console.log(`  ⏳ 等待 ${retryDelay}ms 后重试...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        } else if (!isRetryable) {
          throw error;
        }
      }
    }

    throw lastError;
  }

  // ── 硅基流动专属调用（智能路由 + Bearer修复 + 自动降级） ──────
  /**
   * 调用硅基流动 API（直接 axios，确保 Bearer 格式正确）
   * 智能路由：根据 prompt 内容 + styleChip 自动选择最优模型
   * 自动降级：主模型繁忙（非200）时自动切换到 fallback 模型
   *
   * @param {string} prompt - 请求内容
   * @param {string} styleChip - 风格 chip 参数（可选，用于路由判断）
   */
  async _callSiliconFlow(prompt, styleChip = '') {
    const sfCfg   = this.config.siliconflow || {};
    const apiKey  = sfCfg.api_key || '';
    const apiBase = (sfCfg.api_base || 'https://api.siliconflow.cn/v1').replace(/\/$/, '');
    const hasStyleProfile = !!this.stylePrompt;

    if (!apiKey || apiKey.startsWith('YOUR_')) {
      throw new Error('硅基流动 API Key 未配置，请在设置中填入 sk- 开头的 Key');
    }

    // ── 智能路由：选择模型 ──
    const primaryModel  = _autoSelectSFModel(prompt, styleChip, sfCfg.model);
    const fallbackModel = SF_ROUTE.fallback === primaryModel
      ? SF_ROUTE.creative  // 如果主模型已经是 fallback，就用 DeepSeek-V3
      : SF_ROUTE.fallback;

    console.log(`  🧠 SF智能路由 → 主模型: ${primaryModel}，备用: ${fallbackModel}`);

    const systemContent = hasStyleProfile
      ? '你是一位专业的代笔写手，你的首要任务是精准模仿指定作者的写作风格，包括语气、句式和叙述习惯，输出高质量原创公众号文章。'
      : '你是一位资深的微信公众号主编，擅长多素材融合改写，输出高质量、高原创度的公众号文章。';

    const requestBody = {
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user',   content: prompt },
      ],
      temperature: sfCfg.temperature ?? 0.8,
      max_tokens:  sfCfg.max_tokens  ?? 8000,
      stream: false,
    };

    // ── 硬性要求：Bearer 后必须有一个空格 ──
    const authHeader = `Bearer ${apiKey}`;

    const callModel = async (model, label) => {
      console.log(`  📡 调用 SF ${label}: ${model}`);
      const resp = await axios.post(
        `${apiBase}/chat/completions`,
        { ...requestBody, model },
        {
          headers: {
            'Authorization': authHeader,          // ✅ Bearer {空格} Key
            'Content-Type':  'application/json',
          },
          timeout: 120000,
          validateStatus: null, // 不 throw，拿到 status 再判断
        }
      );
      return resp;
    };

    // ── 主模型调用（最多2次重试）──
    let lastResp = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        lastResp = await callModel(primaryModel, `主模型（尝试${attempt}）`);
        if (lastResp.status === 200) {
          const content = lastResp.data?.choices?.[0]?.message?.content;
          if (content) {
            console.log(`  ✓ SF 主模型成功 (${primaryModel})`);
            return content;
          }
        }
        // 401 不重试，直接失败
        if (lastResp.status === 401) {
          const errMsg = lastResp.data?.message || 'API Key 无效';
          throw new Error(`硅基流动 401 认证失败：${errMsg}。请检查 API Key 是否正确。`);
        }
        // 5xx → 尝试降级
        if (lastResp.status >= 500) {
          console.warn(`  ⚠️ SF 主模型繁忙 (HTTP ${lastResp.status})，准备降级...`);
          break;
        }
        // 其他非200错误
        if (lastResp.status !== 200) {
          const errMsg = lastResp.data?.message || lastResp.data?.error?.message || `HTTP ${lastResp.status}`;
          if (attempt >= 2) throw new Error(`硅基流动调用失败：${errMsg}`);
          await new Promise(r => setTimeout(r, 2000));
        }
      } catch (err) {
        if (err.message.includes('401')) throw err; // 认证错误直接抛出
        if (attempt >= 2) {
          console.warn(`  ⚠️ SF 主模型异常 (${err.message})，准备降级...`);
          break;
        }
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    // ── 自动降级：切换到 fallback 模型 ──
    console.log(`  🔄 SF 自动降级 → 备用模型: ${fallbackModel}`);
    try {
      const fallbackResp = await callModel(fallbackModel, '备用模型');
      if (fallbackResp.status === 200) {
        const content = fallbackResp.data?.choices?.[0]?.message?.content;
        if (content) {
          console.log(`  ✓ SF 降级成功 (${fallbackModel})`);
          return content;
        }
      }
      if (fallbackResp.status === 401) {
        throw new Error(`硅基流动 401 认证失败（备用模型）。请检查 API Key 是否正确。`);
      }
      const errMsg = fallbackResp.data?.message || fallbackResp.data?.error?.message || `HTTP ${fallbackResp.status}`;
      throw new Error(`硅基流动主模型和备用模型均失败：${errMsg}`);
    } catch (err) {
      throw err;
    }
  }




  async _getWenxinToken() {
    if (this.wenxinToken && this.wenxinToken.expires > Date.now()) {
      return this.wenxinToken.token;
    }
    const response = await axios({
      method: 'post',
      url: 'https://aip.baidubce.com/oauth/2.0/token',
      params: {
        grant_type: 'client_credentials',
        client_id: this.config.wenxin.api_key,
        client_secret: this.config.wenxin.secret_key
      }
    });
    this.wenxinToken = {
      token: response.data.access_token,
      expires: Date.now() + (response.data.expires_in - 60) * 1000
    };
    return this.wenxinToken.token;
  }

  async _callWenxin(prompt) {
    const token = await this._getWenxinToken();
    const modelConfig = this.config.wenxin;
    const modelEndpoints = {
      'ernie-bot-4': 'ernie_bot_4',
      'ernie-bot': 'completions',
      'ernie-speed': 'ernie_speed'
    };
    const endpoint = modelEndpoints[modelConfig.model] || 'ernie_bot_4';
    const url = `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/${endpoint}?access_token=${token}`;
    const response = await axios({
      method: 'post',
      url,
      data: {
        messages: [{ role: 'user', content: prompt }],
        temperature: modelConfig.temperature
      }
    });
    return response.data.result;
  }




  async _generate(prompt, styleChip = '') {
    const provider = this.config.provider;

    if (provider === 'siliconflow') {
      // v2.9.8+：硅基流动走专属方法（智能路由 + Bearer修复 + 降级熔断）
      return await this._callSiliconFlow(prompt, styleChip);
    } else if (provider === 'deepseek' || provider === 'tongyi') {
      return await this._callOpenAICompatible(prompt);
    } else if (provider === 'wenxin') {
      return await this._callWenxin(prompt);
    } else {
      throw new Error(`不支持的 AI 提供商: ${provider}`);
    }
  }



  // ── 解析 AI 输出 ────────────────────────────────────────────

  _parseOutput(output) {
    const result = { title: '', summary: '', content: '', tags: [] };
    try {
      const titleMatch   = output.match(/---TITLE---\s*([\s\S]*?)(?=---SUMMARY---|---CONTENT---|---END---)/);
      const summaryMatch = output.match(/---SUMMARY---\s*([\s\S]*?)(?=---CONTENT---|---END---)/);
      const contentMatch = output.match(/---CONTENT---\s*([\s\S]*?)(?=---TAGS---|---END---)/);
      const tagsMatch    = output.match(/---TAGS---\s*([\s\S]*?)(?=---END---)/);

      if (titleMatch)   result.title   = titleMatch[1].trim();
      if (summaryMatch) result.summary = summaryMatch[1].trim();
      if (contentMatch) result.content = contentMatch[1].trim();
      if (tagsMatch)    result.tags    = tagsMatch[1].trim().split(',').map(t => t.trim()).filter(Boolean);

      if (!result.content) {
        result.content = output;
      }
    } catch (e) {
      result.content = output;
    }
    return result;
  }

  // ── 公开方法 ────────────────────────────────────────────────

  /**
   * 【核心】多篇文章聚合融合改写 → 一篇原创文章
   * @param {Array} articles  文章数组（2篇以上效果最佳）
   * @param {string} styleChip 风格参数（用于智能模型路由，可选）
   * @returns {Object}        改写结果对象
   */
  async mergeRewrite(articles, styleChip = '') {
    if (!articles || articles.length === 0) {
      throw new Error('至少需要 1 篇文章');
    }

    if (articles.length === 1) {
      console.log(`  🤖 单篇改写模式（仅抓到 1 篇）...`);
      return await this.singleRewrite(articles[0], styleChip);
    }

    console.log(`  🤖 正在将 ${articles.length} 篇文章聚合融合改写...`);
    const prompt = this._buildMergePrompt(articles);
    const rawOutput = await this._generate(prompt, styleChip);
    const parsed = this._parseOutput(rawOutput);

    // 汇总所有来源信息
    const sources = articles.map(a => a.source || '未知').filter((v, i, arr) => arr.indexOf(v) === i);
    const originalUrls = articles.map(a => a.url).filter(Boolean);
    const originalTitles = articles.map(a => a.title);

    return {
      // 改写结果
      title:          parsed.title || articles[0].title,
      summary:        parsed.summary,
      content:        parsed.content,
      tags:           parsed.tags,
      // 元信息
      mergedFrom:     originalTitles,
      originalUrls:   originalUrls,
      originalSource: sources.join('、'),
      mergeCount:     articles.length,
      provider:       this.config.provider,
      rewrittenAt:    new Date().toISOString()
    };
  }

  /**
   * 单篇改写（兜底用）
   * @param {Object} article - 文章对象
   * @param {string} styleChip - 风格参数（用于智能模型路由，可选）
   */
  async singleRewrite(article, styleChip = '') {
    console.log(`  🤖 正在改写: ${article.title.substring(0, 30)}...`);
    const prompt = this._buildSinglePrompt(article);
    const rawOutput = await this._generate(prompt, styleChip);
    const parsed = this._parseOutput(rawOutput);

    return {
      title:          parsed.title || article.title,
      summary:        parsed.summary,
      content:        parsed.content,
      tags:           parsed.tags,
      mergedFrom:     [article.title],
      originalUrls:   [article.url],
      originalSource: article.source || '',
      mergeCount:     1,
      provider:       this.config.provider,
      rewrittenAt:    new Date().toISOString()
    };
  }
}

module.exports = AIRewriter;
