/* ════════════════════════════════════════════════════════
   公众号写作助手 v3.0 - 前端交互逻辑
   左侧导航布局版本
   ════════════════════════════════════════════════════════ */

// ── 全局状态 ────────────────────────────────────────────
const state = {
  currentPage: 'intelligence',
  writeMode: 'quick',
  rewriteMode: 'quick',
  currentStyle: 'yushitang',
  importMethod: 'file',
  selectedMaterials: [],
  outlineItems: [
    { title: '引言：背景介绍', desc: '' },
    { title: '主体：详细分析', desc: '' },
    { title: '结论：总结展望', desc: '' }
  ],
  isGenerating: false,
  currentArticle: null,
  styles: {
    yushitang: { name: '豫事堂', count: 15, features: ['民生关注', '数据支撑', '通俗易懂'] },
    zaiwang: { name: '载望教育', count: 0, features: [] }
  }
};

// Tavily API Key
const TAVILY_API_KEY = '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';

// ── 初始化 ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  loadInitialData();
  console.log('公众号写作助手 v3.0 已加载');
});

// ── 事件监听初始化 ──────────────────────────────────────
function initEventListeners() {
  // 文件上传
  const uploadZone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('file-input');
  
  if (uploadZone && fileInput) {
    uploadZone.addEventListener('click', () => fileInput.click());
    uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadZone.classList.add('dragover');
    });
    uploadZone.addEventListener('dragleave', () => {
      uploadZone.classList.remove('dragover');
    });
    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadZone.classList.remove('dragover');
      handleFiles(e.dataTransfer.files);
    });
    fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
  }
}

// ── 页面切换 ────────────────────────────────────────────
function switchPage(page) {
  state.currentPage = page;
  
  // 更新导航高亮
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  
  // 切换页面显示
  document.querySelectorAll('.page').forEach(el => {
    el.classList.toggle('active', el.id === `page-${page}`);
  });
}

// ── 加载初始数据 ────────────────────────────────────────
async function loadInitialData() {
  // 加载本地热点
  await refreshLocalHot();
  // 加载全网热点
  await refreshGlobalHot();
}

// ── 刷新本地热点 ────────────────────────────────────────
async function refreshLocalHot() {
  const listEl = document.getElementById('local-hot-list');
  if (!listEl) return;
  
  // 模拟本地热点数据
  const localHotData = [
    { rank: 1, title: '郑州地铁运营里程突破500公里，市民出行更便捷', source: '大河报', time: '2小时前', heat: '521万', trend: 'up', top3: true },
    { rank: 2, title: '河南省发布2024年重点民生实事清单', source: '河南省政府网', time: '3小时前', heat: '487万', trend: 'up', top3: true },
    { rank: 3, title: '洛阳牡丹文化节将于4月开幕，预计接待游客超千万', source: '洛阳日报', time: '5小时前', heat: '392万', trend: 'down', top3: true },
    { rank: 4, title: '河南博物院推出数字化展览，让文物"活"起来', source: '河南日报', time: '6小时前', heat: '276万', trend: 'flat' },
    { rank: 5, title: '开封市启动老旧小区改造工程，惠及居民2万余户', source: '开封网', time: '8小时前', heat: '198万', trend: 'up' },
    { rank: 6, title: '新乡市打造"一刻钟便民生活圈"，提升居民幸福感', source: '新乡日报', time: '10小时前', heat: '165万', trend: 'up' },
    { rank: 7, title: '南阳中医药产业发展迅速，年产值突破300亿元', source: '南阳晚报', time: '12小时前', heat: '142万', trend: 'flat' },
    { rank: 8, title: '许昌智能制造产业园投入使用，创造就业岗位5000个', source: '许昌晨报', time: '14小时前', heat: '128万', trend: 'down' },
    { rank: 9, title: '信阳毛尖春茶开采，茶农增收有望超20%', source: '信阳日报', time: '16小时前', heat: '115万', trend: 'up' },
    { rank: 10, title: '驻马店农产品加工产业蓬勃发展，带动农民增收', source: '驻马店日报', time: '18小时前', heat: '98万', trend: 'flat' }
  ];
  
  renderHotList(listEl, localHotData);
}

// ── 刷新全网热点（Tavily）───────────────────────────────
async function refreshGlobalHot() {
  const listEl = document.getElementById('global-hot-list');
  if (!listEl) return;
  
  // 显示加载状态
  listEl.innerHTML = '<div class="empty-state"><p>正在获取全网热点...</p></div>';
  
  try {
    // 调用 Tavily API 获取热点
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TAVILY_API_KEY}`
      },
      body: JSON.stringify({
        query: '今日热点新闻 中国',
        search_depth: 'basic',
        max_results: 20,
        include_domains: [
          'sina.com.cn', '163.com', 'qq.com', 'sohu.com',
          'ifeng.com', 'people.com.cn', 'xinhuanet.com',
          'chinadaily.com.cn', 'cctv.com', 'baidu.com'
        ]
      })
    });
    
    if (!response.ok) throw new Error('API 请求失败');
    
    const data = await response.json();
    
    if (data.results && data.results.length > 0) {
      const globalHotData = data.results.slice(0, 20).map((r, i) => ({
        rank: i + 1,
        title: r.title,
        source: new URL(r.url).hostname.replace('www.', ''),
        time: '刚刚',
        heat: `${Math.floor(Math.random() * 800 + 200)}万`,
        trend: Math.random() > 0.5 ? 'up' : (Math.random() > 0.5 ? 'down' : 'flat'),
        top3: i < 3,
        url: r.url
      }));
      
      renderHotList(listEl, globalHotData);
    } else {
      // 使用模拟数据
      const mockGlobalData = [
        { rank: 1, title: '国家发改委发布最新产业政策，支持高端制造业发展', source: '新华社', time: '10分钟前', heat: '1023万', trend: 'up', top3: true },
        { rank: 2, title: '教育部回应高考改革，2025年将有重大调整', source: '央视新闻', time: '25分钟前', heat: '892万', trend: 'up', top3: true },
        { rank: 3, title: '人工智能技术应用在医疗领域取得新突破', source: '科技日报', time: '1小时前', heat: '756万', trend: 'up', top3: true },
        { rank: 4, title: '全国多地出台政策支持大学生创业就业', source: '人民日报', time: '1小时前', heat: '634万', trend: 'flat' },
        { rank: 5, title: '新能源汽车销量再创新高，市场份额持续扩大', source: '经济日报', time: '2小时前', heat: '521万', trend: 'down' },
        { rank: 6, title: '全国多地开展春季植树造林活动，助力生态文明建设', source: '新华网', time: '2小时前', heat: '487万', trend: 'up' },
        { rank: 7, title: '教育部发布2024年义务教育阶段新课程标准', source: '教育部官网', time: '3小时前', heat: '423万', trend: 'flat' },
        { rank: 8, title: '科技部发布2024年国家重点研发计划申报指南', source: '科技部', time: '4小时前', heat: '398万', trend: 'down' },
        { rank: 9, title: '全国铁路迎来春运返程高峰，单日发送旅客创新高', source: '中国铁路', time: '4小时前', heat: '356万', trend: 'up' },
        { rank: 10, title: '医保局发布新版医保目录，多种新药纳入报销范围', source: '医保局', time: '5小时前', heat: '312万', trend: 'flat' },
        { rank: 11, title: '央行宣布降准0.5个百分点，释放流动性约1万亿元', source: '央行官网', time: '6小时前', heat: '298万', trend: 'up' },
        { rank: 12, title: '全国多地启动春季招聘，提供就业岗位超百万', source: '人社部', time: '7小时前', heat: '276万', trend: 'up' },
        { rank: 13, title: '文旅部发布2024年文旅融合发展指导意见', source: '文旅部', time: '8小时前', heat: '254万', trend: 'flat' },
        { rank: 14, title: '工信部推动5G应用规模化发展，加快数字化转型', source: '工信部', time: '9小时前', heat: '231万', trend: 'up' },
        { rank: 15, title: '农业农村部部署春季农业生产工作', source: '农业农村部', time: '10小时前', heat: '218万', trend: 'flat' },
        { rank: 16, title: '生态环境部发布2023年全国生态环境质量报告', source: '生态环境部', time: '11小时前', heat: '195万', trend: 'down' },
        { rank: 17, title: '交通运输部推进智慧交通建设，提升出行体验', source: '交通运输部', time: '12小时前', heat: '182万', trend: 'up' },
        { rank: 18, title: '卫健委发布春季传染病防控指南', source: '卫健委', time: '13小时前', heat: '168万', trend: 'up' },
        { rank: 19, title: '应急管理部部署春季防灾减灾工作', source: '应急管理部', time: '14小时前', heat: '145万', trend: 'flat' },
        { rank: 20, title: '市场监管总局加强食品安全监管力度', source: '市场监管总局', time: '15小时前', heat: '132万', trend: 'down' }
      ];
      renderHotList(listEl, mockGlobalData);
    }
  } catch (err) {
    console.error('获取全网热点失败:', err);
    // 使用模拟数据
    const mockGlobalData = [
      { rank: 1, title: '国家发改委发布最新产业政策，支持高端制造业发展', source: '新华社', time: '10分钟前', heat: '1023万', trend: 'up', top3: true },
      { rank: 2, title: '教育部回应高考改革，2025年将有重大调整', source: '央视新闻', time: '25分钟前', heat: '892万', trend: 'up', top3: true },
      { rank: 3, title: '人工智能技术应用在医疗领域取得新突破', source: '科技日报', time: '1小时前', heat: '756万', trend: 'up', top3: true },
      { rank: 4, title: '全国多地出台政策支持大学生创业就业', source: '人民日报', time: '1小时前', heat: '634万', trend: 'flat' },
      { rank: 5, title: '新能源汽车销量再创新高，市场份额持续扩大', source: '经济日报', time: '2小时前', heat: '521万', trend: 'down' }
    ];
    renderHotList(listEl, mockGlobalData);
  }
}

// ── 渲染热点列表 ────────────────────────────────────────
function renderHotList(container, data) {
  container.innerHTML = data.map(item => `
    <div class="hot-item" onclick="selectHotTopic('${escapeHtml(item.title)}', '${escapeHtml(item.source)}')">
      <span class="hot-rank ${item.top3 ? 'top3' : ''}">${item.rank}</span>
      <div class="hot-content">
        <p class="hot-title">${escapeHtml(item.title)}</p>
        <div class="hot-meta">
          <span class="hot-source">${escapeHtml(item.source)}</span>
          <span class="hot-time">${item.time}</span>
          <span class="hot-heat">🔥 ${item.heat}</span>
        </div>
      </div>
      <span class="hot-trend ${item.trend}">${item.trend === 'up' ? '↑' : item.trend === 'down' ? '↓' : '-'}</span>
    </div>
  `).join('');
}

// ── 选择热点话题 ────────────────────────────────────────
function selectHotTopic(title, source) {
  showToast(`已选择: ${title.substring(0, 20)}...`, 'success');
  // 可以添加到素材或直接进入创作
}

// ── 打开消息源管理 ──────────────────────────────────────
function openSourceManager() {
  document.getElementById('source-manager-modal').classList.remove('hidden');
}

// ── 关闭消息源管理 ──────────────────────────────────────
function closeSourceManager() {
  document.getElementById('source-manager-modal').classList.add('hidden');
}

// ── 保存消息源设置 ──────────────────────────────────────
function saveSourceSettings() {
  showToast('消息源设置已保存', 'success');
  closeSourceManager();
}

// ── 添加自定义消息源 ────────────────────────────────────
function addCustomSource() {
  const name = document.getElementById('custom-source-name').value;
  const url = document.getElementById('custom-source-url').value;
  
  if (!name || !url) {
    showToast('请填写完整信息', 'warning');
    return;
  }
  
  showToast(`已添加消息源: ${name}`, 'success');
  document.getElementById('custom-source-name').value = '';
  document.getElementById('custom-source-url').value = '';
}

// ── 风格选择 ────────────────────────────────────────────
function selectStyle(styleId) {
  state.currentStyle = styleId;
  
  document.querySelectorAll('.style-option').forEach(el => {
    el.classList.toggle('active', el.dataset.style === styleId);
  });
}

// ── 创作模式切换 ────────────────────────────────────────
function switchWriteMode(mode) {
  state.writeMode = mode;
}

// ── 编辑器标签切换 ──────────────────────────────────────
function switchEditorTab(tab) {
  document.querySelectorAll('.editor-tab').forEach(el => {
    el.classList.toggle('active', el.textContent.includes(tab === 'outline' ? '大纲' : '素材'));
  });
  
  document.getElementById('editor-outline').classList.toggle('hidden', tab !== 'outline');
  document.getElementById('editor-materials').classList.toggle('hidden', tab !== 'materials');
}

// ── 生成大纲 ────────────────────────────────────────────
function generateOutline() {
  showToast('AI 正在生成大纲...', 'info');
  
  setTimeout(() => {
    state.outlineItems = [
      { title: '引言：背景介绍与问题提出', desc: '简述当前热点背景，引出核心问题' },
      { title: '现状分析：多维度数据呈现', desc: '引用权威数据，客观呈现现状' },
      { title: '深度解读：专家观点与趋势判断', desc: '整合多方观点，提供深度分析' },
      { title: '结语：总结与展望', desc: '总结核心观点，展望未来趋势' }
    ];
    renderOutline();
    showToast('大纲生成完成', 'success');
  }, 1500);
}

// ── 渲染大纲 ────────────────────────────────────────────
function renderOutline() {
  const listEl = document.getElementById('outline-list');
  if (!listEl) return;
  
  listEl.innerHTML = state.outlineItems.map((item, i) => `
    <div class="outline-item">
      <span class="outline-num">${String(i + 1).padStart(2, '0')}</span>
      <input type="text" class="outline-title" value="${escapeHtml(item.title)}" placeholder="章节标题" />
      <textarea class="outline-desc" placeholder="章节要点...">${escapeHtml(item.desc)}</textarea>
    </div>
  `).join('');
}

// ── 添加大纲项 ──────────────────────────────────────────
function addOutlineItem() {
  state.outlineItems.push({ title: '', desc: '' });
  renderOutline();
}

// ── 生成文章 ────────────────────────────────────────────
async function generateArticle() {
  if (state.isGenerating) return;
  
  state.isGenerating = true;
  showToast('开始创作文章...', 'info');
  
  // 模拟生成过程
  await sleep(2000);
  
  const mockArticle = `
<h1>河南数字经济蓬勃发展，助力中原崛起新征程</h1>

<p>近年来，随着国家"数字中国"战略的深入推进，河南省紧抓数字经济发展机遇，以数字化转型为引领，推动经济社会高质量发展。</p>

<h2>01 现状分析</h2>
<p>据统计，2024年河南省数字经济规模突破1.5万亿元，占GDP比重超过35%。郑州、洛阳等城市已成为全国重要的数字产业集聚地。</p>

<h2>02 政策支持</h2>
<p>河南省政府高度重视数字经济发展，出台了一系列支持政策，明确提出到2025年数字经济规模突破2万亿元的目标。</p>

<h2>03 未来展望</h2>
<p>数字经济正在成为河南高质量发展的新引擎，为中原崛起注入强劲动力。</p>

<p style="color: #999; font-size: 14px; margin-top: 30px;">— 由 AI 辅助生成，请核实关键信息</p>
  `.trim();
  
  document.getElementById('article-preview').innerHTML = mockArticle;
  state.currentArticle = mockArticle;
  state.isGenerating = false;
  
  showToast('文章创作完成！', 'success');
}

// ── 复制预览 ────────────────────────────────────────────
function copyPreview() {
  if (!state.currentArticle) {
    showToast('暂无内容可复制', 'warning');
    return;
  }
  
  navigator.clipboard.writeText(state.currentArticle).then(() => {
    showToast('文章已复制到剪贴板', 'success');
  });
}

// ── 导出预览 ────────────────────────────────────────────
function exportPreview() {
  if (!state.currentArticle) {
    showToast('暂无内容可导出', 'warning');
    return;
  }
  
  const blob = new Blob([state.currentArticle], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'article.html';
  a.click();
  URL.revokeObjectURL(url);
  
  showToast('文章已导出', 'success');
}

// ── 风格学习页面 ────────────────────────────────────────
function createNewStyle() {
  const name = prompt('请输入新风格名称:');
  if (name) {
    showToast(`已创建风格: ${name}`, 'success');
  }
}

function importToStyle(styleId) {
  state.currentStyle = styleId;
  document.getElementById('current-style-name').textContent = state.styles[styleId]?.name || styleId;
  showToast(`正在导入文章到 ${state.styles[styleId]?.name || styleId}`, 'info');
}

function viewStyleDetail(styleId) {
  showToast(`查看 ${state.styles[styleId]?.name || styleId} 详情`, 'info');
}

// ── 导入方式切换 ────────────────────────────────────────
function switchImportMethod(method) {
  state.importMethod = method;
  
  document.querySelectorAll('.import-method').forEach(el => {
    el.classList.toggle('active', el.dataset.method === method);
  });
  
  document.getElementById('import-file').classList.toggle('hidden', method !== 'file');
  document.getElementById('import-paste').classList.toggle('hidden', method !== 'paste');
  document.getElementById('import-url').classList.toggle('hidden', method !== 'url');
}

// ── 处理文件上传 ────────────────────────────────────────
function handleFiles(files) {
  if (!files.length) return;
  
  Array.from(files).forEach(file => {
    showToast(`已选择文件: ${file.name}`, 'success');
  });
}

// ── 粘贴提交 ────────────────────────────────────────────
function submitPaste() {
  const content = document.getElementById('paste-editor').value;
  if (!content.trim()) {
    showToast('请输入文章内容', 'warning');
    return;
  }
  
  showToast('文章已提交学习', 'success');
  document.getElementById('paste-editor').value = '';
}

function clearPaste() {
  document.getElementById('paste-editor').value = '';
}

// ── URL 抓取 ────────────────────────────────────────────
async function fetchUrl() {
  const url = document.getElementById('url-input').value;
  if (!url) {
    showToast('请输入文章链接', 'warning');
    return;
  }
  
  showToast('正在抓取文章...', 'info');
  
  // 模拟抓取
  setTimeout(() => {
    document.getElementById('url-preview').innerHTML = `
      <div style="padding: 16px; background: var(--bg-tertiary); border-radius: 8px; margin-top: 12px;">
        <p style="font-weight: 600; margin-bottom: 8px;">抓取成功</p>
        <p style="font-size: 13px; color: var(--text-secondary);">${url}</p>
      </div>
    `;
    showToast('文章抓取成功', 'success');
  }, 1500);
}

// ── 删除已导入文章 ──────────────────────────────────────
function removeArticle(btn) {
  btn.closest('.article-item').remove();
  showToast('文章已移除', 'info');
}

// ── 二次改写页面 ────────────────────────────────────────
function switchRewriteImport(type) {
  document.querySelectorAll('.import-tab').forEach(el => {
    el.classList.toggle('active', el.textContent.includes(type === 'file' ? '文件' : type === 'paste' ? '粘贴' : '链接'));
  });
  
  document.getElementById('rewrite-import-file').classList.toggle('hidden', type !== 'file');
  document.getElementById('rewrite-import-paste').classList.toggle('hidden', type !== 'paste');
  document.getElementById('rewrite-import-url').classList.toggle('hidden', type !== 'url');
}

function switchRewriteMode(mode) {
  state.rewriteMode = mode;
  
  document.querySelectorAll('.mode-tab').forEach(el => {
    el.classList.toggle('active', el.textContent.includes(mode === 'quick' ? '快速' : '深度'));
  });
  
  document.getElementById('chapters-editor').classList.toggle('hidden', mode !== 'deep');
}

function addPastedArticle() {
  const textarea = document.querySelector('#rewrite-import-paste textarea');
  if (!textarea.value.trim()) {
    showToast('请粘贴文章内容', 'warning');
    return;
  }
  
  showToast('文章已添加为素材', 'success');
  textarea.value = '';
}

function generateChapters() {
  showToast('AI 正在生成章节...', 'info');
  
  setTimeout(() => {
    const listEl = document.getElementById('chapters-list');
    listEl.innerHTML = `
      <div class="chapter-item">
        <input type="text" value="引言：背景介绍" placeholder="章节标题" />
        <textarea placeholder="章节要求...">简述背景，引出主题</textarea>
      </div>
      <div class="chapter-item">
        <input type="text" value="主体：详细分析" placeholder="章节标题" />
        <textarea placeholder="章节要求...">深入分析核心内容</textarea>
      </div>
      <div class="chapter-item">
        <input type="text" value="结论：总结展望" placeholder="章节标题" />
        <textarea placeholder="章节要求...">总结要点，展望未来</textarea>
      </div>
    `;
    showToast('章节生成完成', 'success');
  }, 1500);
}

function addChapter() {
  const listEl = document.getElementById('chapters-list');
  const count = listEl.children.length + 1;
  
  const div = document.createElement('div');
  div.className = 'chapter-item';
  div.innerHTML = `
    <input type="text" placeholder="章节 ${count} 标题" />
    <textarea placeholder="章节要求..."></textarea>
  `;
  listEl.appendChild(div);
}

function startRewrite() {
  showToast('开始改写...', 'info');
  
  setTimeout(() => {
    document.getElementById('rewrite-preview-content').innerHTML = `
      <div style="padding: 20px;">
        <h2 style="margin-bottom: 16px;">改写完成</h2>
        <p style="line-height: 1.8; color: var(--text-secondary);">
          这里是改写后的文章内容。基于您提供的素材，AI 已经按照选定的风格进行了深度改写，
          生成了原创性更高的内容。您可以在右侧预览效果，并根据需要进行调整。
        </p>
      </div>
    `;
    showToast('改写完成！', 'success');
  }, 2000);
}

function copyRewrite() {
  showToast('改写内容已复制', 'success');
}

function exportRewrite() {
  showToast('改写内容已导出', 'success');
}

// ── 历史文章页面 ────────────────────────────────────────
function searchHistory() {
  const keyword = document.getElementById('history-search').value;
  showToast(`搜索: ${keyword || '全部文章'}`, 'info');
}

// ── 工具函数 ────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Toast 通知 ──────────────────────────────────────────
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  
  toast.innerHTML = `
    <span style="font-size: 16px;">${icons[type]}</span>
    <span>${escapeHtml(message)}</span>
  `;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
