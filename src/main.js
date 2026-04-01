'use strict';

/**
 * 公众号自动化写作工具 - 主程序
 * 功能：
 *   1. 同步历史文章   —— 从公众号 API 拉取全量历史文章存本地
 *   2. 分析写作风格   —— AI 分析历史文章，生成个人风格档案
 *   3. 生成新文章     —— 抓取新闻 → 参考风格档案 → 聚合改写 → 推送草稿箱
 */

const inquirer = require('inquirer');
const chalk = require('chalk');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const ora = require('ora');

const NewsScraper     = require('./scraper');
const AIRewriter      = require('./rewriter');
const MarkdownFormatter = require('./formatter');
const WeixinPublisher = require('./publisher');
const HistorySync     = require('./history-sync');
const StyleAnalyzer   = require('./style-analyzer');
const HotTopics       = require('./hot-topics');

// ─── 加载配置 ────────────────────────────────────────────────
function loadConfig() {
  const configPath = path.join(__dirname, '..', 'config.yaml');
  if (!fs.existsSync(configPath)) {
    console.error(chalk.red('❌ 找不到 config.yaml，请确认文件存在'));
    process.exit(1);
  }
  return yaml.load(fs.readFileSync(configPath, 'utf8'));
}

// ─── 打印 Banner ─────────────────────────────────────────────
function printBanner() {
  console.log(chalk.cyan('\n╔═══════════════════════════════════════════╗'));
  console.log(chalk.cyan('║    公众号自动化写作工具 v2.0               ║'));
  console.log(chalk.cyan('║    WeChat Auto Writer - Style AI           ║'));
  console.log(chalk.cyan('╚═══════════════════════════════════════════╝\n'));
}

// ─── 主菜单 ──────────────────────────────────────────────────
async function showMainMenu(config) {
  const styleAnalyzer = new StyleAnalyzer(config);
  const historySync   = new HistorySync(config);
  const profile       = styleAnalyzer.loadProfile();
  const localDb       = historySync.loadLocal();

  // 状态提示
  const profileStatus = profile
    ? chalk.green(`✓ 已建立（${profile._meta?.sample_count || '?'}篇样本，${profile._meta?.analyzed_at?.substring(0, 10) || ''}）`)
    : chalk.yellow('✗ 尚未建立');

  const historyStatus = localDb
    ? chalk.green(`✓ 已同步 ${localDb.total} 篇文章（${localDb.synced_at?.substring(0, 10) || ''}）`)
    : chalk.yellow('✗ 尚未同步');

  console.log(`  风格档案状态：${profileStatus}`);
  console.log(`  历史文章状态：${historyStatus}\n`);

  const { action } = await inquirer.prompt([{
    type: 'list',
    name: 'action',
    message: '请选择操作：',
    choices: [
      { name: '✍️  生成新文章（抓取新闻 + AI改写 + 推送草稿箱）', value: 'write' },
      { name: '🔥 每日河南热点（自动检索10个热点话题供参考）', value: 'hotTopics' },
      new inquirer.Separator('── 风格学习 ──'),
      { name: '📂 手动导入本地文章（将文章粘贴为txt放入data/import/）', value: 'import' },
      { name: '🎨 分析写作风格（AI提炼个人风格档案）', value: 'analyze' },
      { name: '👁️  查看当前风格档案', value: 'viewProfile' },
      new inquirer.Separator('──────────────'),
      { name: '❌ 退出', value: 'exit' },
    ]
  }]);

  return action;
}

// ─── 功能 0：每日河南热点 ────────────────────────────────────
async function showHotTopics(config) {
  const hotTopics = new HotTopics(config);
  await hotTopics.run();
}

// ─── 功能 1b：手动导入本地文章 ──────────────────────────────
async function importLocalArticles(config) {
  console.log(chalk.blue('\n📂 手动导入本地文章\n'));

  const importDir = path.join(process.cwd(), 'data', 'import');

  // 确保目录存在
  if (!fs.existsSync(importDir)) {
    fs.mkdirSync(importDir, { recursive: true });
  }

  const files = fs.readdirSync(importDir).filter(f => f.endsWith('.txt') || f.endsWith('.md'));

  if (files.length === 0) {
    console.log(chalk.yellow('  ⚠️  data/import/ 目录下暂无文章文件'));
    console.log(chalk.white('\n  操作方法：'));
    console.log(chalk.white(`  1. 在以下目录中新建 .txt 或 .md 文件：`));
    console.log(chalk.yellow(`     ${importDir}`));
    console.log(chalk.white('  2. 每个文件 = 一篇文章，文件名 = 文章标题'));
    console.log(chalk.white('  3. 文件内容 = 文章正文（直接粘贴即可，不需要特殊格式）'));
    console.log(chalk.white('  4. 保存文件后重新选择此菜单项\n'));
    return;
  }

  console.log(chalk.gray(`  发现 ${files.length} 个文章文件，开始导入...\n`));
  files.forEach((f, i) => {
    console.log(chalk.gray(`  [${i + 1}] ${f}`));
  });

  const syncer = new HistorySync(config);
  const articles = syncer.importFromFiles();

  console.log(chalk.green(`\n  ✅ 导入完成！共 ${articles.length} 篇文章已保存到 data/articles.json`));
  console.log(chalk.yellow('\n💡 下一步：选择「分析写作风格」，让AI提炼你的个人风格档案\n'));
}

// ─── 功能 2：分析写作风格 ────────────────────────────────────
async function analyzeStyle(config) {
  console.log(chalk.blue('\n🎨 分析写作风格\n'));

  const historySync   = new HistorySync(config);
  const styleAnalyzer = new StyleAnalyzer(config);
  const localDb       = historySync.loadLocal();

  if (!localDb) {
    console.log(chalk.yellow('⚠️  尚未同步历史文章，请先执行「同步历史文章」'));
    return;
  }

  const samples = historySync.getSamples(15);
  if (samples.length < 3) {
    console.log(chalk.yellow(`⚠️  有效文章样本不足（当前 ${samples.length} 篇，至少需要 3 篇）`));
    return;
  }

  console.log(chalk.gray(`  将分析最新 ${samples.length} 篇文章（共 ${localDb.total} 篇中筛选出正文≥300字的）`));

  const { confirm } = await inquirer.prompt([{
    type: 'confirm',
    name: 'confirm',
    message: `确认开始分析？（将调用 ${config.ai.provider} 模型，消耗约 5000-8000 tokens）`,
    default: true
  }]);

  if (!confirm) return;

  const spinner = ora('AI 正在分析你的写作风格...').start();

  try {
    const profile = await styleAnalyzer.analyze(samples, (msg) => {
      spinner.text = msg;
    });

    spinner.succeed(chalk.green('✅ 风格档案已生成！'));
    console.log('');
    styleAnalyzer.printProfileSummary(profile);
    console.log(chalk.gray('\n   档案已保存到 data/style_profile.json'));
    console.log(chalk.yellow('\n💡 下一步：选择「生成新文章」，AI将自动模仿你的风格写作\n'));

  } catch (err) {
    spinner.fail(chalk.red(`❌ 分析失败：${err.message}`));
  }
}

// ─── 功能 3：查看风格档案 ────────────────────────────────────
async function viewProfile(config) {
  console.log(chalk.blue('\n👁️  当前风格档案\n'));

  const styleAnalyzer = new StyleAnalyzer(config);
  const profile = styleAnalyzer.loadProfile();

  if (!profile) {
    console.log(chalk.yellow('  ⚠️  尚未建立风格档案，请先执行「分析写作风格」'));
    return;
  }

  console.log(chalk.cyan('═══════════════════════════════════════'));
  console.log(chalk.bold(`  作者风格档案`));
  console.log(chalk.cyan('═══════════════════════════════════════'));

  console.log(`\n  📝 风格概述：${chalk.white(profile.summary)}`);

  if (profile.tone) {
    console.log(`\n  🎙️  语气特征`);
    console.log(`     描述：${profile.tone.description}`);
    console.log(`     关键词：${(profile.tone.keywords || []).join('、')}`);
    console.log(`     情感强度：${profile.tone.emotion}`);
  }

  if (profile.perspective) {
    console.log(`\n  🔭 观点立场`);
    console.log(`     立场：${profile.perspective.stance}`);
    console.log(`     文章类型：${profile.perspective.style}`);
  }

  if (profile.structure) {
    console.log(`\n  🏗️  文章结构`);
    console.log(`     开篇：${profile.structure.opening_style}`);
    console.log(`     逻辑：${profile.structure.body_logic}`);
    console.log(`     结尾：${profile.structure.closing_style}`);
  }

  if (profile.language?.signature_expressions?.length) {
    console.log(`\n  💬 标志性表达`);
    profile.language.signature_expressions.forEach(e => console.log(`     • ${e}`));
  }

  if (profile.sample_sentences?.length) {
    console.log(`\n  ✍️  代表性句子`);
    profile.sample_sentences.forEach((s, i) => console.log(`     ${i + 1}. "${s}"`));
  }

  if (profile.writing_instructions) {
    console.log(`\n  📋 AI写作指令（核心）`);
    console.log(chalk.yellow('     ' + profile.writing_instructions.replace(/\n/g, '\n     ')));
  }

  if (profile._meta) {
    console.log(`\n  ℹ️  元信息`);
    console.log(`     分析时间：${profile._meta.analyzed_at?.substring(0, 10)}`);
    console.log(`     样本数量：${profile._meta.sample_count} 篇`);
    console.log(`     使用模型：${profile._meta.provider} / ${profile._meta.model}`);
  }

  console.log(chalk.cyan('\n═══════════════════════════════════════\n'));
}

// ─── 功能 4：生成新文章（核心流程）─────────────────────────
async function writeArticle(config) {
  console.log(chalk.blue('\n✍️  生成新文章\n'));

  const styleAnalyzer = new StyleAnalyzer(config);
  const historySync   = new HistorySync(config);
  const profile       = styleAnalyzer.loadProfile();
  const hasProfile    = !!profile;

  if (!hasProfile) {
    console.log(chalk.yellow('  💡 提示：尚未建立风格档案，将使用通用写作风格'));
    console.log(chalk.yellow('     建议先「同步历史文章」→「分析写作风格」，效果更好\n'));
  } else {
    console.log(chalk.green(`  ✓ 已加载风格档案：${profile.summary}`));
  }

  // 询问关键词（若从热点话题跳转过来，自动预填）
  let defaultKeyword = '';
  const pendingTopicPath = path.join(__dirname, '..', 'data', '.pending_topic.txt');
  if (fs.existsSync(pendingTopicPath)) {
    try {
      defaultKeyword = fs.readFileSync(pendingTopicPath, 'utf8').trim();
      fs.unlinkSync(pendingTopicPath); // 读取后删除临时文件
      console.log(chalk.green(`  ✓ 已从热点话题预填关键词：「${defaultKeyword}」\n`));
    } catch (e) { /* 读取失败忽略 */ }
  }

  const { keyword } = await inquirer.prompt([{
    type: 'input',
    name: 'keyword',
    message: '请输入搜索关键词（如：人工智能、房价、教育改革）：',
    default: defaultKeyword || undefined,
    validate: v => v.trim() ? true : '关键词不能为空'
  }]);

  const { articleCount } = await inquirer.prompt([{
    type: 'list',
    name: 'articleCount',
    message: '抓取并融合多少篇文章？',
    choices: [
      { name: '3篇（快速）', value: 3 },
      { name: '5篇（推荐）', value: 5 },
      { name: '8篇（内容更丰富）', value: 8 },
    ],
    default: 1
  }]);

  // ── Step 1：抓取新闻 ─────────────────────────────────────────
  console.log(chalk.blue(`\n🔍 Step 1: 抓取「${keyword}」相关新闻\n`));
  const spinner1 = ora('正在抓取...').start();

  const scraper = new NewsScraper({ ...config, scraper: { ...config.scraper, max_articles: articleCount + 3 } });
  let articles = [];

  try {
    articles = await scraper.fetchNews(keyword);
    spinner1.succeed(`抓取到 ${articles.length} 篇文章`);
  } catch (err) {
    spinner1.fail(`抓取失败：${err.message}`);
    return;
  }

  if (articles.length === 0) {
    console.log(chalk.red('❌ 未抓取到任何文章，请检查网络或更换关键词'));
    return;
  }

  // 展示文章列表供选择
  const { selectedTitles } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'selectedTitles',
    message: `选择要参与融合的文章（建议选 ${Math.min(articleCount, articles.length)} 篇）：`,
    choices: articles.map((a, i) => ({
      name: `[${i + 1}] ${a.title.substring(0, 60)}`,
      value: i,
      checked: i < articleCount
    })),
    validate: v => v.length >= 1 ? true : '至少选择 1 篇'
  }]);

  const selectedArticles = selectedTitles.map(i => articles[i]);

  // ── Step 2：获取历史相似文章（作为风格参考） ──────────────────
  let referenceArticles = [];
  if (hasProfile && historySync.loadLocal()) {
    referenceArticles = historySync.findSimilar(keyword, 2);
    if (referenceArticles.length > 0) {
      console.log(chalk.gray(`\n  📚 找到 ${referenceArticles.length} 篇相关历史文章作为风格参考`));
    }
  }

  // ── Step 3：AI 聚合改写 ──────────────────────────────────────
  console.log(chalk.blue('\n🤖 Step 2: AI 聚合改写\n'));

  const rewriter = new AIRewriter(config);

  // 注入风格档案 + 相似历史文章
  if (hasProfile) {
    const stylePromptText = styleAnalyzer.profileToPrompt(profile, referenceArticles);
    rewriter.setStylePrompt(stylePromptText);
    console.log(chalk.green('  ✓ 已加载个人风格档案，AI将模仿你的写作风格'));
  }

  const spinner2 = ora(`正在将 ${selectedArticles.length} 篇文章融合改写...`).start();
  let result;
  try {
    result = await rewriter.mergeRewrite(selectedArticles);
    spinner2.succeed('改写完成！');
  } catch (err) {
    spinner2.fail(`改写失败：${err.message}`);
    return;
  }

  // ── Step 4：保存 Markdown ────────────────────────────────────
  console.log(chalk.blue('\n💾 Step 3: 保存 Markdown 文件\n'));

  const formatter = new MarkdownFormatter(config);
  const savedResults = formatter.saveAll([result]);
  const indexPath = formatter.saveIndex(savedResults);

  if (savedResults[0]?.success) {
    console.log(chalk.green(`  ✓ 已保存：${savedResults[0].filepath}`));
  }

  // ── Step 5：推送微信草稿箱（可选）────────────────────────────
  const wxConfig = config.weixin || {};
  const wxEnabled = wxConfig.enabled &&
    wxConfig.app_id && !wxConfig.app_id.startsWith('YOUR_');

  if (wxEnabled) {
    console.log(chalk.blue('\n📡 Step 4: 推送到微信公众号草稿箱\n'));
    const spinner3 = ora('正在推送...').start();
    try {
      const publisher = new WeixinPublisher(config);
      const pubResult = await publisher.publish(result, {
        publishDirectly: wxConfig.publish_directly || false
      });

      if (pubResult.status === 'draft') {
        spinner3.succeed(chalk.green('✅ 已保存到草稿箱！请前往公众平台补充封面图后发布'));
      } else {
        spinner3.succeed(chalk.green(`✅ 已提交发布，publish_id: ${pubResult.publishId}`));
      }
    } catch (err) {
      spinner3.fail(chalk.red(`推送失败：${err.message}`));
    }
  } else {
    console.log(chalk.gray('\n💡 微信自动推送未启用，请在 config.yaml 中设置 weixin.enabled: true\n'));
  }

  // ── 预览文章 ─────────────────────────────────────────────────
  console.log(chalk.cyan('\n═══════════════════ 文章预览 ══════════════════'));
  console.log(chalk.bold(`\n  标题：${result.title}`));
  if (result.summary) console.log(chalk.gray(`  摘要：${result.summary}`));
  if (result.tags?.length) console.log(chalk.gray(`  标签：${result.tags.join(' / ')}`));
  console.log(chalk.gray(`  字数：约 ${result.content.replace(/\s/g, '').length} 字`));
  if (result.mergedFrom?.length > 1) {
    console.log(chalk.gray(`  融合：${result.mergedFrom.length} 篇素材`));
  }
  console.log(chalk.cyan('═══════════════════════════════════════════════\n'));
}

// ─── 主入口 ──────────────────────────────────────────────────
async function main() {
  // 支持 --help 参数
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
公众号自动化写作工具 v2.0

用法：
  npm start                   启动交互式菜单
  node src/main.js --help     显示帮助

功能：
  1. 同步历史文章  - 从微信公众号API拉取全量历史文章
  2. 分析写作风格  - AI提炼个人写作风格档案
  3. 生成新文章    - 抓取新闻+风格学习+聚合改写+推送草稿箱
  4. 查看风格档案  - 展示已分析的风格特征

配置文件：config.yaml
输出目录：output/
数据目录：data/（历史文章和风格档案）
    `);
    return;
  }

  printBanner();
  const config = loadConfig();

  while (true) {
    const action = await showMainMenu(config);

    if (action === 'exit') {
      console.log(chalk.gray('\n再见！👋\n'));
      break;
    } else if (action === 'hotTopics') {
      await showHotTopics(config);
    } else if (action === 'import') {
      await importLocalArticles(config);
    } else if (action === 'analyze') {
      await analyzeStyle(config);
    } else if (action === 'viewProfile') {
      await viewProfile(config);
    } else if (action === 'write') {
      await writeArticle(config);
    }

    // 操作完成后暂停，让用户看到结果
    await inquirer.prompt([{
      type: 'input',
      name: '_',
      message: chalk.gray('按 Enter 键返回主菜单...'),
    }]);

    console.clear();
    printBanner();
  }
}

main().catch(err => {
  console.error(chalk.red('\n程序异常退出：'), err.message);
  process.exit(1);
});
