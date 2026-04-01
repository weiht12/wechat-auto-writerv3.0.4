/**
 * Markdown 排版输出模块
 * 将改写后的文章格式化为公众号 Markdown 风格
 */

const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');

class MarkdownFormatter {
  constructor(config) {
    this.config = config;
    this.formatConfig = config.format;
    this.outputConfig = config.output;

    // 确保输出目录存在
    const outputDir = path.resolve(this.outputConfig.directory);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  }

  /**
   * 生成文件名
   */
  _generateFilename(article) {
    const format = this.outputConfig.filename_format;
    const timestamp = dayjs().format('YYYYMMDD_HHmmss');

    if (format === 'datetime') {
      return `${timestamp}.md`;
    } else if (format === 'title') {
      const slug = article.title
        .replace(/[^\u4e00-\u9fa5\w\s-]/g, '')
        .replace(/\s+/g, '_')
        .substring(0, 30);
      return `${slug}_${timestamp}.md`;
    } else {
      return `article_${timestamp}.md`;
    }
  }

  /**
   * 格式化正文内容
   * 规范化 Markdown，使其更适合公众号排版
   */
  _formatContent(content) {
    let formatted = content;

    // 规范化标题层级（将 h1 降级为 h2）
    formatted = formatted.replace(/^# (.+)$/gm, '## $1');

    // 确保段落间有空行
    formatted = formatted.replace(/([^\n])\n([^\n#\-\*])/g, '$1\n\n$2');

    // 规范化列表格式
    formatted = formatted.replace(/^[-\*] /gm, '- ');

    // 清理多余空行（超过 2 个换行合并为 2 个）
    formatted = formatted.replace(/\n{3,}/g, '\n\n');

    // 在引用块前后加空行
    formatted = formatted.replace(/([^\n])\n(>)/g, '$1\n\n$2');
    formatted = formatted.replace(/(>[^\n]*)\n([^>])/g, '$1\n\n$2');

    return formatted.trim();
  }

  /**
   * 渲染完整的公众号 Markdown 文档
   */
  render(article) {
    const now = dayjs().format('YYYY年MM月DD日');
    const lines = [];

    // ===== 封面图占位（可选）=====
    if (this.formatConfig.add_cover_placeholder) {
      lines.push('<!-- 封面图：建议尺寸 900×500 px，将图片拖拽到此处替换 -->');
      lines.push('');
    }

    // ===== 标题 =====
    const titleMark = this.formatConfig.title_level === 'h1' ? '#' : '##';
    lines.push(`${titleMark} ${article.title}`);
    lines.push('');

    // ===== 元信息 =====
    if (this.formatConfig.add_meta) {
      lines.push('---');
      lines.push('');
      if (article.originalSource) {
        lines.push(`**来源参考**：${article.originalSource}`);
      }
      lines.push(`**发布日期**：${now}`);
      lines.push(`**改写模型**：${article.provider || 'AI'}`);
      // 融合来源标注
      if (article.mergeCount && article.mergeCount > 1) {
        lines.push(`**素材融合**：本文由 ${article.mergeCount} 篇文章聚合改写而成`);
      }
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    // ===== 导读摘要 =====
    if (article.summary && article.summary.length > 0) {
      lines.push('> **导读**');
      lines.push('>');
      // 将摘要按行添加为引用块
      article.summary.split('\n').forEach(line => {
        lines.push(`> ${line}`);
      });
      lines.push('');
    }

    // ===== 正文 =====
    lines.push(this._formatContent(article.content));
    lines.push('');

    // ===== 话题标签 =====
    if (this.formatConfig.add_tags && article.tags && article.tags.length > 0) {
      lines.push('');
      lines.push('---');
      lines.push('');
      const tagLine = article.tags.map(t => `\`#${t}\``).join('  ');
      lines.push(`**话题标签**：${tagLine}`);
      lines.push('');
    }

    // ===== 版权与引用声明 =====
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('*本文由 AI 辅助改写，内容仅供参考。如有侵权，请联系删除。*');
    lines.push('');

    // ===== 原文引用（隐藏注释）=====
    lines.push(`<!-- 原文来源: ${article.originalUrl || '未知'} -->`);

    return lines.join('\n');
  }

  /**
   * 保存文章到文件
   */
  save(article) {
    const filename = this._generateFilename(article);
    const outputDir = path.resolve(this.outputConfig.directory);
    const filePath = path.join(outputDir, filename);

    const markdown = this.render(article);
    fs.writeFileSync(filePath, markdown, 'utf-8');

    return { filePath, filename, markdown };
  }

  /**
   * 批量保存
   */
  saveAll(articles) {
    const results = [];
    for (const article of articles) {
      try {
        const result = this.save(article);
        results.push({ ...result, title: article.title, success: true });
        console.log(`  ✓ 已保存: ${result.filename}`);
      } catch (error) {
        console.error(`  ✗ 保存失败: ${error.message}`);
        results.push({ title: article.title, success: false, error: error.message });
      }
    }
    return results;
  }

  /**
   * 生成汇总索引文件
   */
  saveIndex(results) {
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const lines = [
      '# 公众号文章生成记录',
      '',
      `> 生成时间：${now}`,
      `> 共生成 ${results.filter(r => r.success).length} 篇文章`,
      '',
      '| # | 标题 | 文件名 | 状态 |',
      '|---|------|--------|------|'
    ];

    results.forEach((r, i) => {
      const status = r.success ? '✅ 成功' : '❌ 失败';
      const filename = r.filename || '-';
      lines.push(`| ${i + 1} | ${r.title || '未知'} | ${filename} | ${status} |`);
    });

    const indexPath = path.join(path.resolve(this.outputConfig.directory), 'index.md');
    fs.writeFileSync(indexPath, lines.join('\n'), 'utf-8');

    return indexPath;
  }
}

module.exports = MarkdownFormatter;
