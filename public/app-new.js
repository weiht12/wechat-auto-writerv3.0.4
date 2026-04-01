'use strict';

// ═══════════════════════════════════════════════════════
// 公众号 · 写作助手 — 前端交互逻辑
// ═══════════════════════════════════════════════════════

// ── 全局状态 ────────────────────────────────────────────
const state = {
  currentPage:     'dashboard',
  statusData:      null,
  hotTopicsData:   null,
  todayTopics:     null,
  fetchedArticles: [],
  selectedArticles:[],
  profileData:     null,
  pendingKeyword:  null,
};

// ── 初始化 ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initToast();
  loadStatus();
  checkAIStatus();
  renderCustomSourceChips(); // 加载自定义消息源
  initStyleSwitcher();       // 初始化生成文章页风格切换器
  initImitateStyleSwitcher(); // 初始化仿写页风格切换器

  // 事件委托：处理所有带 data-page 的导航点击
  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-page]');
    if (target) {
      e.preventDefault();
      navigate(target.dataset.page);
    }
  });

  // 关键词输入框支持回车搜索
  const kwInput = document.getElementById('kw-input');
  if (kwInput) {
    kwInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') fetchNews();
    });
  }
});

// ════════════════════════════════════════════════════════
// Router Purge — v2.9.3.2
// ════════════════════════════════════════════════════════

/**
 * clearAllTempUI — 路由清场函数（三不准第③条）
 * 在任何页面切换前无条件调用，强制隐藏所有临时 UI：
 *   · write 页全部临时 UI（进度条、结果面板、右侧预览）
 *   · imitate 页全部临时 UI（进度条、结果面板）
 *   · 所有正在进行的 Loading 动画
 * 关键原则：只做 display:none，不做 innerHTML 清空（保留内容，防止二次渲染抖动）
 * 唯一例外：右侧 wx-preview-body 清空 innerHTML（避免旧内容透过其他页面布局泄漏）
 */
function clearAllTempUI() {
  // ── write 页临时 UI ──────────────────────────────────
  const IDS_WRITE_TEMP = [
    'write-result',
    'write-progress-area',
    'wx-side-header',
    'wx-side-actions',
    'wx-side-phone',
  ];
  IDS_WRITE_TEMP.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  // v2.9.8：清场时恢复 step1/step2 可见
  ['write-step1','write-step2'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = '';
  });
  // wx-empty-placeholder 反向：恢复可见（清场时 empty 状态应可见）
  const wxEmpty = document.getElementById('wx-empty-placeholder');
  if (wxEmpty) wxEmpty.style.display = '';
  // 清空预览体，防止旧内容透过 DOM 泄漏
  const wxBody = document.getElementById('wx-preview-body');
  if (wxBody) wxBody.innerHTML = '';

  // ── imitate 页临时 UI ─────────────────────────────────
  const IDS_IMITATE_TEMP = [
    'imitate-result',
    'imitate-progress-area',
  ];
  IDS_IMITATE_TEMP.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  // ── 全局：强制所有 page 内的 .temp-ui 类元素隐藏（扩展口）──
  document.querySelectorAll('.temp-ui').forEach(el => {
    el.style.display = 'none';
  });
}

/**
 * navigate — 路由主函数（三不准第①③条）
 *
 * 执行顺序（铁律，不得调整）：
 *   1. clearAllTempUI()   ← 先清场，再切换，彻底断绝跨页面污染
 *   2. state.currentPage 更新
 *   3. 页面 class 切换
 *   4. 导航高亮更新
 *   5. 懒加载当前页数据
 *
 * 三不准第①条守卫在 renderArticleResult / renderImitateResult 入口实施，
 * 此处通过"先赋值再切换"保证 state.currentPage 在任何 async 回调中已正确。
 */
function navigate(page) {
  // ① 路由清场：必须在更新 state 和 DOM 之前执行
  clearAllTempUI();

  // ② 立即更新全局状态（render 函数读取此值做 Target Locking）
  state.currentPage = page;

  // ③ 切换页面 DOM 可见性
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  const pageEl = document.getElementById('page-' + page);
  if (pageEl) pageEl.classList.add('active');

  // ④ 更新导航高亮
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  // ⑤ 懒加载当前页数据
  if (page === 'hot')     loadHotTopics();
  if (page === 'profile') loadProfile();
  if (page === 'history') loadHistory();
  if (page === 'imitate') loadImitate();
  if (page === 'write') {
    // v2.9.8：切换到写作页时尝试恢复草稿
    setTimeout(_tryRestoreArticleDraft, 50);
    if (state.pendingKeyword) {
      const kw = document.getElementById('kw-input');
      if (kw) kw.value = state.pendingKeyword;
      state.pendingKeyword = null;
      fetchNews();
    }
  }
}

// ════════════════════════════════════════════════════════
// 仪表盘：加载状态
// ════════════════════════════════════════════════════════
async function loadStatus() {
  try {
    const data = await fetchJSON('/api/status');
    state.statusData = data;

    // 风格档案
    const profile = data.profile;
    const elProfile = document.getElementById('stat-profile');
    const elProfileMeta = document.getElementById('stat-profile-meta');
    if (elProfile) elProfile.textContent = profile ? '已建立' : '未建立';
    if (elProfileMeta) elProfileMeta.textContent = profile
      ? profile.sample_count + ' 篇样本 · ' + (profile.analyzed_at || '').substring(0, 10)
      : '请导入文章后分析';

    // 文章库
    const articles = data.articles;
    const elArticles = document.getElementById('stat-articles');
    const elArticlesMeta = document.getElementById('stat-articles-meta');
    if (elArticles) elArticles.textContent = articles ? articles.total + ' 篇' : '0 篇';
    if (elArticlesMeta) elArticlesMeta.textContent = articles
      ? '同步于 ' + (articles.synced_at || '').substring(0, 10)
      : '尚未导入';

    // 生成文章
    const elOutput = document.getElementById('stat-output');
    const elOutputMeta = document.getElementById('stat-output-meta');
    if (elOutput) elOutput.textContent = (data.output ? data.output.length : 0) + ' 篇';
    if (elOutputMeta) elOutputMeta.textContent =
      data.output && data.output.length
        ? '最新：' + (data.output[0].mtime || '').substring(0, 10)
        : '暂无';

    // 热点缓存
    const hot = data.hotCache;
    const elHot = document.getElementById('stat-hot');
    const elHotMeta = document.getElementById('stat-hot-meta');
    if (elHot) elHot.textContent = hot ? hot.count + ' 条' : '无缓存';
    if (elHotMeta) elHotMeta.textContent = hot
      ? '生成于 ' + (hot.generated_at || '').substring(11, 16)
      : '点击「每日热点」获取';

    // 更新热点角标
    if (hot) {
      const badge = document.getElementById('badge-hot');
      if (badge) badge.textContent = hot.count;
    }

    // 渲染最近文章
    renderRecentArticles(data.output || []);
  } catch (err) {
    console.error('loadStatus failed', err);
    // 降级处理：显示错误提示
    const els = ['stat-profile', 'stat-articles', 'stat-output', 'stat-hot'];
    els.forEach(id => {
      const el = document.getElementById(id);
      if (el && el.textContent === '加载中...') el.textContent = '加载失败';
    });
  }
}

function renderRecentArticles(files) {
  const el = document.getElementById('recent-articles');
  if (!el) return;
  if (!files.length) {
    el.innerHTML = '<div class="empty-state">暂无已生成文章，去「生成文章」页面创作吧</div>';
    return;
  }
  el.innerHTML = files.slice(0, 8).map(f => `
    <div class="article-item" onclick="openArticleFromHistory('${f.name}')">
      <div class="article-item-icon">📄</div>
      <div class="article-item-body">
        <div class="article-item-title">${escHtml(f.title)}</div>
        <div class="article-item-meta">${(f.mtime || '').substring(0, 16).replace('T', ' ')} · ${formatSize(f.size)}</div>
      </div>
      <div class="article-item-arrow">›</div>
    </div>
  `).join('');
}

// ════════════════════════════════════════════════════════
// 每日热点
// ════════════════════════════════════════════════════════
let hotLoaded = false;

async function loadHotTopics(forceRefresh = false) {
  if (hotLoaded && !forceRefresh) return;
  hotLoaded = false;

  // v2.9.4: 渲染自定义信源 chips
  renderCustomSourceChips();

  const progressEl = document.getElementById('hot-progress');
  const progressMsg = document.getElementById('hot-progress-msg');
  const topicsEl   = document.getElementById('hot-topics-list');
  const sourceBar  = document.getElementById('source-bar');
  const refreshBtn = document.getElementById('btn-refresh');

  if (progressEl) progressEl.style.display = 'block';
  if (progressMsg) progressMsg.textContent = '正在连接数据源...';
  if (topicsEl) topicsEl.innerHTML = '';
  if (sourceBar) sourceBar.style.display = 'flex';
  if (refreshBtn) refreshBtn.disabled = true;

  const dateDesc = document.getElementById('hot-date-desc');
  if (dateDesc) {
    dateDesc.textContent = '今日 ' + new Date().toLocaleDateString('zh-CN', {
      month: 'long', day: 'numeric', weekday: 'long'
    }) + ' · 河南热点实时监控';
  }

  const customSources = loadCustomSources();
  let url = '/api/hot-topics' + (forceRefresh ? '?refresh=1' : '?');
  if (customSources.length > 0) {
    const sep = forceRefresh ? '&' : '';
    url += sep + 'custom=' + encodeURIComponent(JSON.stringify(customSources));
  }
  const evtSrc = new EventSource(url);

  evtSrc.onmessage = (e) => {
    const msg = JSON.parse(e.data);

    if (msg.type === 'cached') {
      if (progressMsg) progressMsg.textContent = '使用今日缓存（生成于 ' + (msg.generated_at || '').substring(11, 16) + '）';
      if (msg.site_stats) updateSourceBar(msg.site_stats);
    }
    if (msg.type === 'progress') {
      if (progressMsg) progressMsg.textContent = msg.msg;
    }
    if (msg.type === 'stats') {
      updateSourceBar(msg.site_stats);
      if (progressMsg) progressMsg.textContent = '已抓取 ' + msg.total + ' 条资讯，AI 正在提炼热点话题...';
    }
    if (msg.type === 'topics' || msg.__done) {
      if (msg.error) {
        if (progressEl) progressEl.style.display = 'none';
        if (progressMsg) progressMsg.textContent = '';
        if (topicsEl) topicsEl.innerHTML = '<div class="empty-state" style="color:#f87171">⚠️ ' + escHtml(msg.error) + '</div>';
        showToast(msg.error, 'error');
        if (refreshBtn) refreshBtn.disabled = false;
        evtSrc.close();
        return;
      }
      if (msg.topics) {
        state.hotTopicsData = msg.topics;
        if (msg.site_stats) updateSourceBar(msg.site_stats);
        renderHotTopics(msg.topics);
        if (progressEl) progressEl.style.display = 'none';
        if (progressMsg) progressMsg.textContent = '';
        hotLoaded = true;
        const badge = document.getElementById('badge-hot');
        if (badge) badge.textContent = msg.topics.length;
      }
      if (refreshBtn) refreshBtn.disabled = false;
      evtSrc.close();
    }
  };

  evtSrc.onerror = () => {
    if (progressEl) progressEl.style.display = 'none';
    if (progressMsg) progressMsg.textContent = '';
    if (topicsEl) topicsEl.innerHTML = '<div class="empty-state" style="color:#f87171">连接服务器失败，请刷新页面</div>';
    if (refreshBtn) refreshBtn.disabled = false;
    evtSrc.close();
  };
}

function updateSourceBar(stats) {
  // 更新内置消息源 chip
  const builtinMap = { '大河财立方': 'dahecube', '河南省政府': 'gov', '百度新闻': 'baidu' };
  for (const [label, id] of Object.entries(builtinMap)) {
    const dot = document.getElementById('src-dot-' + id);
    const cnt = document.getElementById('src-count-' + id);
    const count = stats[label] != null ? stats[label] : -1;
    if (dot) dot.className = 'source-chip-dot ' + (count > 0 ? 'ok' : 'err');
    if (cnt) cnt.textContent = count >= 0 ? ' ' + count + '条' : ' 失败';
  }
  // 更新自定义消息源 chip
  const customSources = loadCustomSources();
  customSources.forEach((s, i) => {
    const dot = document.getElementById('src-dot-custom-' + i);
    const count = stats[s.name] != null ? stats[s.name] : -1;
    if (dot) dot.className = 'source-chip-dot ' + (count > 0 ? 'ok' : (count === 0 ? 'err' : ''));
  });
}

function updateSearchSourceBar(stats) {
  const searchMap = { '百度新闻': 'search-baidu', '必应': 'search-bing', 'Google': 'search-google' };
  for (const [label, id] of Object.entries(searchMap)) {
    const el = document.getElementById('src-' + id);
    if (!el) continue;
    const count = stats[label] != null ? stats[label] : -1;
    const dot = el.querySelector('.source-dot');
    const cnt = el.querySelector('.source-count');
    if (dot) dot.className = 'source-dot ' + (count > 0 ? 'ok' : 'err');
    if (cnt) cnt.textContent = count >= 0 ? count + '条' : '失败';
  }
}

function renderHotTopics(topics) {
  const el = document.getElementById('hot-topics-list');
  if (!el) return;
  if (!topics || !topics.length) {
    el.innerHTML = '<div class="empty-state">暂无热点数据</div>';
    return;
  }
  state.todayTopics = topics;
  el.innerHTML = topics.map(t => {
    const rankClass = t.no <= 5 ? ' rank-' + t.no : '';
    const sourceHtml = t.source ? '<span class="topic-source">' + escHtml(t.source) + '</span>' : '';
    const timeHtml = t.time ? '<span style="font-size:11px;color:var(--text-muted)">' + escHtml(t.time) + '</span>' : '';
    const angleHtml = t.angle ? '<div class="topic-angle">' + escHtml(t.angle) + '</div>' : '';
    return `
    <div class="topic-card">
      <div class="topic-num${rankClass}">${t.no}</div>
      <div class="topic-body">
        <div class="topic-title">${escHtml(t.title)}</div>
        ${angleHtml}
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-top:6px">
          ${sourceHtml}${timeHtml}
        </div>
      </div>
      <div class="topic-action">
        <button class="btn btn-secondary btn-sm" onclick="useTopicForWrite(${t.no - 1})">
          <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
          写这篇
        </button>
      </div>
    </div>`;
  }).join('');
}

function useTopicForWrite(index) {
  const topics = state.hotTopicsData;
  if (!topics || !topics[index]) return;
  state.pendingKeyword = topics[index].title;
  navigate('write');
}

// ── 本地热点关键词搜索 ──────────────────────────────────
function searchLocalHotTopics() {
  const keyword = document.getElementById('local-hot-keyword').value.trim();
  if (!keyword) {
    showToast('请输入搜索关键词');
    document.getElementById('local-hot-keyword').focus();
    return;
  }
  const progressEl = document.getElementById('local-search-progress');
  const msgEl      = document.getElementById('local-search-msg');
  const btn        = document.getElementById('btn-local-search');
  const listEl     = document.getElementById('hot-topics-list');
  const sourceBar  = document.getElementById('search-source-bar');

  if (progressEl) progressEl.style.display = 'block';
  if (msgEl) msgEl.textContent = '正在搜索「' + keyword + '」...';
  if (btn) { btn.disabled = true; btn.textContent = '搜索中...'; }
  if (listEl) listEl.innerHTML = '';
  if (sourceBar) sourceBar.style.display = 'flex';

  updateSearchSourceBar({ '百度新闻': 0, '必应': 0, 'Google': 0 });

  const evtSrc = new EventSource('/api/hot-topics-search?keyword=' + encodeURIComponent(keyword));
  evtSrc.onmessage = function(e) {
    const msg = JSON.parse(e.data);
    if (msg.type === 'progress' || msg.type === 'cached') {
      if (msgEl) msgEl.textContent = msg.msg || '';
    }
    if (msg.type === 'search_topics' || msg.__done) {
      evtSrc.close();
      if (progressEl) progressEl.style.display = 'none';
      if (btn) { btn.disabled = false; btn.textContent = '搜索'; }
      if (msg.error) {
        if (listEl) listEl.innerHTML = '<div class="empty-state">⚠️ ' + escHtml(msg.error) + '</div>';
        return;
      }
      if (msg.topics && msg.topics.length > 0) {
        renderSearchTopics(msg.topics, keyword);
        showToast('找到 ' + msg.topics.length + ' 个「' + keyword + '」相关选题');
      } else {
        if (listEl) listEl.innerHTML = '<div class="empty-state">未找到「' + escHtml(keyword) + '」的相关选题，请换个关键词试试</div>';
      }
    }
  };
  evtSrc.onerror = () => {
    evtSrc.close();
    if (progressEl) progressEl.style.display = 'none';
    if (btn) { btn.disabled = false; btn.textContent = '搜索'; }
    if (listEl) listEl.innerHTML = '<div class="empty-state">⚠️ 搜索失败，请稍后重试</div>';
  };
}

function renderSearchTopics(topics, keyword) {
  const el = document.getElementById('hot-topics-list');
  if (!el) return;
  const header = `
    <div class="search-result-header">
      <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
      「${escHtml(keyword)}」搜索结果
      <button class="btn btn-ghost btn-sm" onclick="restoreHotTopics()" style="margin-left:auto">← 返回今日热点</button>
    </div>`;
  el.innerHTML = header + topics.map(t => `
    <div class="topic-card topic-card-search">
      <div class="topic-num">${t.no}</div>
      <div class="topic-body">
        <div class="topic-title">${escHtml(t.title)}</div>
        ${t.angle ? '<div class="topic-angle">📌 ' + escHtml(t.angle) + '</div>' : ''}
        ${t.source ? '<span class="topic-source">' + escHtml(t.source) + '</span>' : ''}
      </div>
      <div class="topic-action">
        <button class="btn btn-secondary btn-sm" onclick="useSearchTopicForWrite('${escHtml(t.title).replace(/'/g, "\\'")}')">
          <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
          写这篇
        </button>
      </div>
    </div>
  `).join('');
}

function useSearchTopicForWrite(title) {
  state.pendingKeyword = title;
  navigate('write');
}

function restoreHotTopics() {
  document.getElementById('local-hot-keyword').value = '';
  if (state.todayTopics) {
    renderHotTopics(state.todayTopics);
  } else {
    loadHotTopics();
  }
}

// ════════════════════════════════════════════════════════
// 生成文章
// ════════════════════════════════════════════════════════
async function fetchNews() {
  const keyword = document.getElementById('kw-input').value.trim();
  if (!keyword) { showToast('请输入搜索关键词', 'error'); return; }

  const count      = parseInt(document.getElementById('count-select').value, 10);
  const useTavily  = document.getElementById('tavily-enabled') ? document.getElementById('tavily-enabled').checked : false;
  const btn        = document.getElementById('btn-fetch');
  const newsEl     = document.getElementById('news-list');
  const step2      = document.getElementById('write-step2');

  setLoading(btn, true, '搜索中...');
  if (newsEl) { newsEl.style.display = 'none'; newsEl.innerHTML = ''; }
  if (step2) step2.style.display = 'none';

  try {
    const data = await fetchJSON('/api/fetch-news', { method: 'POST', body: { keyword, count, useTavily } });
    state.fetchedArticles = data.articles || [];
    if (!state.fetchedArticles.length) {
      showToast('未找到相关新闻，请更换关键词', 'error');
      return;
    }

    if (newsEl) {
      newsEl.innerHTML = state.fetchedArticles.map((a, i) => `
        <div class="news-item checked" id="news-${i}" onclick="toggleNews(${i})">
          <input type="checkbox" id="chk-${i}" ${i < count ? 'checked' : ''} onclick="event.stopPropagation();toggleNews(${i})" />
          <div class="news-item-title">${escHtml(a.title)}</div>
          <div class="news-item-source">${escHtml(a.source || '')}</div>
        </div>
      `).join('');
    }

    state.selectedArticles = state.fetchedArticles.slice(0, count).map((_, i) => i);
    state.fetchedArticles.forEach((_, i) => {
      if (i >= count) {
        const ni = document.getElementById('news-' + i);
        if (ni) ni.classList.remove('checked');
      }
    });

    updateSelectedBadge();
    if (newsEl) newsEl.style.display = 'block';
    if (step2) step2.style.display = 'block';
  } catch (err) {
    showToast('搜索失败：' + err.message, 'error');
  } finally {
    setLoading(btn, false);
  }
}

function toggleNews(index) {
  const item = document.getElementById('news-' + index);
  const chk  = document.getElementById('chk-' + index);
  if (!chk) return;
  const isChecked = !chk.checked;
  chk.checked = isChecked;
  if (item) item.classList.toggle('checked', isChecked);
  if (isChecked) {
    if (!state.selectedArticles.includes(index)) state.selectedArticles.push(index);
  } else {
    state.selectedArticles = state.selectedArticles.filter(i => i !== index);
  }
  updateSelectedBadge();
}

function updateSelectedBadge() {
  const badge = document.getElementById('selected-count-badge');
  if (!badge) return;
  const n = state.selectedArticles.length;
  badge.textContent = n ? '已选 ' + n + ' 篇' : '';
}

function switchWriteMode(mode) {
  const form         = document.getElementById('custom-direction-form');
  const defaultLabel = document.getElementById('mode-default');
  const customLabel  = document.getElementById('mode-custom');
  if (mode === 'custom') {
    if (form) form.style.display = 'block';
    if (defaultLabel) defaultLabel.classList.remove('active');
    if (customLabel) customLabel.classList.add('active');
  } else {
    if (form) form.style.display = 'none';
    if (defaultLabel) defaultLabel.classList.add('active');
    if (customLabel) customLabel.classList.remove('active');
  }
}

async function writeArticle() {
  if (!state.selectedArticles.length && !state.fetchedArticles.length) {
    showToast('请先搜索并选择新闻', 'error');
    return;
  }
  const keyword   = document.getElementById('kw-input').value.trim();
  const btn       = document.getElementById('btn-write');
  const progArea  = document.getElementById('write-progress-area');
  const progMsg   = document.getElementById('write-progress-msg');
  const resultEl  = document.getElementById('write-result');

  const writeModeEl = document.querySelector('input[name="write-mode"]:checked');
  const writeMode   = writeModeEl ? writeModeEl.value : 'default';
  const customDirection = document.getElementById('custom-direction') ? document.getElementById('custom-direction').value.trim() : '';
  const customOutline   = document.getElementById('custom-outline') ? document.getElementById('custom-outline').value.trim() : '';
  const useDeepResearch = document.getElementById('deep-research-enabled') ? document.getElementById('deep-research-enabled').checked : false;
  // 从风格切换器 Dropdown 读取，'none' 表示不使用风格档案
  const styleSwitcher = document.getElementById('style-switcher');
  const selectedStyleId = styleSwitcher ? styleSwitcher.value : 'yushtang';
  const useStyleProfile = selectedStyleId !== 'none';

  setLoading(btn, true, 'AI 生成中...');
  if (progArea) progArea.style.display = 'block';
  if (resultEl) resultEl.style.display = 'none';

  const articles = state.selectedArticles.map(i => state.fetchedArticles[i]).filter(Boolean);
  setWriteStep(1, 'active');
  if (progMsg) progMsg.textContent = '准备就绪，AI 开始改写...';

  try {
    const resp = await fetch('/api/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keyword, articles, writeMode,
        customDirection: writeMode === 'custom' ? customDirection : undefined,
        customOutline:   writeMode === 'custom' ? customOutline : undefined,
        useDeepResearch, useStyleProfile,
        profileId: useStyleProfile ? selectedStyleId : undefined,
      }),
    });
    if (!resp.ok) throw new Error('服务器错误 ' + resp.status);
    if (!resp.body) throw new Error('浏览器不支持流式读取');

    const reader  = resp.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const msg = JSON.parse(line.slice(5).trim());
        if (msg.type === 'progress') {
          if (progMsg) progMsg.textContent = msg.msg;
          if (msg.step === 1) setWriteStep(1, 'active');
          if (msg.step === 2) { setWriteStep(1, 'done'); setWriteStep(2, 'active'); }
          if (msg.step === 3) { setWriteStep(2, 'done'); setWriteStep(3, 'active'); }
          if (msg.step === 4) { setWriteStep(3, 'done'); setWriteStep(4, 'active'); }
        }
        if (msg.__done) {
          if (msg.error) {
            showToast('生成失败：' + msg.error, 'error');
            setWriteStep(1, '');
          } else {
            setWriteStep(3, 'done');
            if (msg.wxResult && !msg.wxResult.error) setWriteStep(4, 'done');
            renderArticleResult(msg);
            if (progMsg) progMsg.textContent = '✓ 生成完成！';
            loadStatus();
          }
        }
      }
    }
  } catch (err) {
    showToast('生成失败：' + err.message, 'error');
    if (progMsg) progMsg.textContent = '⚠️ 生成失败：' + err.message;
  } finally {
    setLoading(btn, false);
  }
}

function setWriteStep(num, st) {
  const el = document.getElementById('wstep-' + num);
  if (!el) return;
  el.className = 'write-step' + (st ? ' ' + st : '');
  const icon = el.querySelector('.wstep-icon');
  if (!icon) return;
  icon.textContent = st === 'active' ? '⚙️' : st === 'done' ? '✅' : '⏳';
}

function renderArticleResult(data) {
  // ══════════════════════════════════════════════════════
  // 三不准第①②条 — 双重 Target Locking 守卫
  // 守卫一：state 级别（JS 状态机）
  // 守卫二：DOM 级别（物理归属检查）
  // 两道守卫必须同时通过，否则直接拒绝渲染，不抛异常
  // ══════════════════════════════════════════════════════

  // 守卫一：state 检查
  if (state.currentPage !== 'write') {
    console.warn('[renderArticleResult] ⛔ 守卫一拦截 — 当前页：' + state.currentPage + '，不是 write，渲染取消');
    return;
  }
  // 守卫二：DOM 归属检查 — #write-result 必须在 #page-write.active 内
  const pageWriteEl = document.getElementById('page-write');
  if (!pageWriteEl || !pageWriteEl.classList.contains('active')) {
    console.warn('[renderArticleResult] ⛔ 守卫二拦截 — #page-write 不是 active，渲染取消');
    return;
  }
  // 守卫三：严禁 document.body.appendChild（用 Scoped Mount 锁定写入目标）
  const resultEl = document.getElementById('write-result');
  if (!resultEl || !pageWriteEl.contains(resultEl)) {
    console.error('[renderArticleResult] ⛔ 守卫三拦截 — write-result 不在 page-write 内，DOM 结构异常');
    return;
  }

  // ── 标题 ──────────────────────────────────────────────
  const titleEl = document.getElementById('result-title-header');
  if (titleEl) titleEl.textContent = data.title || '文章已生成';

  // v3.0.1：不再折叠 step1/step2，文章区追加在搜索区下方，滚动查看
  // 只隐藏进度条
  const progArea = document.getElementById('write-progress-area');
  if (progArea) progArea.style.display = 'none';

  // ── Scoped Mount：只允许写入 #page-write 内的 #write-result ──
  resultEl.style.display = 'flex'; // flex 才能让内部子元素按 flex 方向填充

  // 滚动到文章区，方便用户立刻看到结果
  setTimeout(() => { resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 150);

  // ── 字数 ──────────────────────────────────────────────
  const wcEl = document.getElementById('result-wordcount');
  if (wcEl) wcEl.textContent = '约 ' + (data.wordCount || 0) + ' 字';

  // ── 标签 ──────────────────────────────────────────────
  const tagsEl = document.getElementById('result-tags');
  if (tagsEl) tagsEl.innerHTML = (data.tags || []).map(t => '<span class="tag-chip">' + escHtml(t) + '</span>').join('');

  // ── 微信推送状态 ───────────────────────────────────────
  const wxEl = document.getElementById('result-wx-status');
  if (wxEl) {
    if (data.wxResult && !data.wxResult.error) {
      wxEl.textContent = '已推送草稿箱';
      wxEl.style.color = '#34d399';
    } else if (data.wxResult && data.wxResult.error) {
      // v3.0.2 修复：显示详细错误信息（包括 HTTP 状态码和微信API错误码）
      let errorMsg = '草稿推送失败：' + data.wxResult.error;
      if (data.wxResult.details) {
        if (data.wxResult.details.status) {
          errorMsg += ` (HTTP ${data.wxResult.details.status})`;
        }
        if (data.wxResult.details.data && data.wxResult.details.data.errcode) {
          errorMsg += ` [微信错误码 ${data.wxResult.details.data.errcode}]`;
        }
      }
      wxEl.textContent = errorMsg;
      wxEl.style.color = '#f87171';
    } else {
      wxEl.textContent = '';
    }
  }

  // ── 摘要 ──────────────────────────────────────────────
  const summaryEl = document.getElementById('result-summary');
  if (summaryEl) {
    summaryEl.style.display = data.summary ? 'block' : 'none';
    if (data.summary) summaryEl.textContent = data.summary;
  }

  // ── 正文：渲染到中栏可编辑区域 ───────────────────────
  // v2.9.3: 文章直接出现在按钮下方，禁止任何页面跳转 / 刷新
  const contentEl = document.getElementById('result-content');
  if (contentEl) {
    const rawMd = data.content || '';
    let html = typeof marked !== 'undefined' ? marked.parse(rawMd) : rawMd.replace(/\n/g, '<br>');

    // v3.0.4 美学优化：添加精致配图占位槽到中栏
    let imgSlotIdx = 0;
    const makeImgSlot = (sectionTitle) => {
      imgSlotIdx++;
      return `<div class="img-placeholder" style="width:100%;height:140px;background:linear-gradient(135deg,#f0f8f8 0%,#e0f0f0 100%);display:flex;align-items:center;justify-content:center;border-radius:12px;margin:20px 0;color:#148085;font-size:13px;border:2px dashed #b8d8d8;opacity:0.85;box-shadow:0 2px 8px rgba(20,128,133,0.06);">
        <span style="background:#fff;padding:8px 16px;border-radius:20px;box-shadow:0 2px 6px rgba(20,128,133,0.1);">📷 配图区域 · ${escHtml(sectionTitle)}</span></div>`;
    };
    html = html.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (match, content) => {
      const cleanContent = content.replace(/^\s*\d{1,2}[\s\.\:：\-]+\s*/, '').trim();
      return match + makeImgSlot(cleanContent);
    });

    contentEl.innerHTML = html;

    // 挂载实时同步：编辑中栏 → 右侧预览自动刷新
    // 防抖 500ms，严禁高频触发 marked.parse（卡顿根源）
    if (!contentEl._syncBound) {
      contentEl._syncBound = true;
      let syncTimer = null;
      contentEl.addEventListener('input', () => {
        clearTimeout(syncTimer);
        syncTimer = setTimeout(() => {
          const currentTitle = document.getElementById('result-title-header')
            ? document.getElementById('result-title-header').textContent : '';
          // 直接用中栏已渲染的 innerHTML 注入预览，跳过二次 marked.parse
          refreshPreviewHTML(currentTitle, contentEl.innerHTML);
        }, 500);
      });
    }
  }

  // ── 同屏闭环：实时注入右侧预览（不跳转）────────────────
  refreshPreview(data.title || '未命名文章', data.content || '');

  // v2.9.8：自动保存草稿到 localStorage（供刷新恢复）
  _saveArticleDraft({
    title:   data.title   || '',
    content: data.content || '',
    tags:    data.tags    || [],
    wordCount: data.wordCount || 0,
    savedAt: Date.now(),
  });

  // ── 异步 FLUX 配图（仅 siliconflow provider 时生效）────
  const _titleForImg = data.title || '公众号文章';
  genImagesAsync(contentEl, _titleForImg);
}

/**
 * refreshPreview — 公开接口，将标题+Markdown内容实时注入右侧微信排版预览列
 * 任何位置修改内容后均可调用此函数，无需跳转或重新加载
 * @param {string} title   文章标题
 * @param {string} mdContent  Markdown 格式正文
 */
function refreshPreview(title, mdContent) {
  updateWxPreview(title, mdContent);
}

/**
 * refreshPreviewHTML — 编辑时专用
 * 直接把中栏 innerHTML 注入右侧预览，跳过 marked.parse + formatSectionHeadings
 * 避免每次 input 都触发大量正则替换导致卡顿
 */
function refreshPreviewHTML(title, html) {
  const phoneEl  = document.getElementById('wx-side-phone');
  const bodyEl   = document.getElementById('wx-preview-body');
  const titleEl  = document.getElementById('wx-preview-title');
  const emptyEl  = document.getElementById('wx-empty-placeholder');
  const headerEl = document.getElementById('wx-side-header');
  const actionsEl= document.getElementById('wx-side-actions');
  const badgeEl  = document.getElementById('wx-side-badge');

  if (!bodyEl) return;

  if (phoneEl)   phoneEl.style.display  = '';
  if (emptyEl)   emptyEl.style.display  = 'none';
  if (headerEl)  headerEl.style.display = '';
  if (actionsEl) actionsEl.style.display= '';
  if (titleEl)   titleEl.textContent    = title;

  bodyEl.innerHTML = html;

  if (badgeEl) {
    const len = (bodyEl.innerText || '').replace(/\s/g,'').length;
    badgeEl.textContent = len > 0 ? `${len} 字` : '';
  }
}

function copyArticle() {
  const content = document.getElementById('result-content').innerText;
  navigator.clipboard.writeText(content)
    .then(() => showToast('正文已复制到剪贴板', 'success'))
    .catch(() => showToast('复制失败，请手动选择复制', 'error'));
}

/**
 * genArticleImages — v2.9.8 已弃用，由 openImagePanel 取代
 * 保留供向后兼容（仿写页面的 genImagesAsync 仍可调用旧逻辑）
 */
async function genArticleImages() {
  openImagePanel();
}

// ════════════════════════════════════════════════════════
// v2.9.8 AI 配图面板逻辑
// 流程：openImagePanel → analyzeArticleKeywords → doGenImages → insertSelectedImages
// ════════════════════════════════════════════════════════

/** 存储配图面板生成的结果 */
let _imagePanelResults = [];
/** 已选中的图片 URL 集合 */
let _imagePanelSelected = new Set();

/** 打开配图面板 */
function openImagePanel() {
  const container = document.getElementById('result-content');
  if (!container || !container.textContent.trim()) {
    showToast('请先生成文章后再使用 AI 配图', 'warning');
    return;
  }
  const modal = document.getElementById('image-panel-modal');
  if (modal) modal.classList.add('open');
  // 同步加载当前 config 里的 image_model
  fetchJSON('/api/config').then(cfg => {
    const sel = document.getElementById('image-model-select');
    if (sel && cfg.siliconflow_image_model) {
      sel.value = cfg.siliconflow_image_model;
    }
  }).catch(() => {});
  // 重置结果区
  _imagePanelResults = [];
  _imagePanelSelected = new Set();
  const wrap = document.getElementById('image-results-wrap');
  const progress = document.getElementById('image-gen-progress');
  const insertBtn = document.getElementById('btn-insert-images');
  const doBtn = document.getElementById('btn-do-gen-image');
  if (wrap)     wrap.style.display = 'none';
  if (progress) progress.style.display = 'none';
  if (insertBtn) insertBtn.style.display = 'none';
  if (doBtn)    doBtn.style.display = '';
}

/** 关闭配图面板 */
function closeImagePanel(event) {
  if (event && event.target !== document.getElementById('image-panel-modal')) return;
  const modal = document.getElementById('image-panel-modal');
  if (modal) modal.classList.remove('open');
}

/** 分析文章关键词 */
function analyzeArticleKeywords() {
  const container = document.getElementById('result-content');
  const listEl = document.getElementById('image-keywords-list');
  const promptEl = document.getElementById('image-prompt-input');
  const titleEl = document.getElementById('result-title-header');
  if (!container || !listEl) return;

  const title = (titleEl?.textContent || '').trim();
  const text = container.innerText || '';

  // 提取章节标题（section-title 类的文字）
  const sectionTitles = Array.from(container.querySelectorAll('.section-title-148085'))
    .map(el => el.textContent.trim())
    .filter(t => t.length > 0);

  // 若无章节标题，提取前几个关键短语（简单取名词词组）
  let keywords = sectionTitles.length > 0 ? sectionTitles : [];

  if (!keywords.length) {
    // 从文章文本中提取关键词（取前5个不重复短句中的关键词）
    const sentences = text.split(/[，。！？\n]+/).filter(s => s.trim().length > 4 && s.trim().length < 30);
    keywords = sentences.slice(0, 5).map(s => s.trim());
  }

  // 如果仍然为空，用标题
  if (!keywords.length && title) keywords = [title];

  // 渲染关键词 chip
  listEl.innerHTML = keywords.map((kw, i) =>
    `<span class="style-chip ${i === 0 ? 'active' : ''}"
      style="cursor:pointer;font-size:12px;padding:4px 10px"
      onclick="selectImageKeyword(this, '${kw.replace(/'/g, '&#39;')}')"
      data-kw="${escHtml(kw)}">${escHtml(kw)}</span>`
  ).join('');

  // 自动填入第一个关键词到 prompt
  if (keywords.length && promptEl) {
    const mainKw = title ? title : keywords[0];
    promptEl.value = `${mainKw}，${keywords.slice(0,2).join('，')}，微信公众号配图，简洁专业，写实风格，高清画质`;
  }
}

/** 点击关键词 chip，更新 prompt */
function selectImageKeyword(el, kw) {
  // 清除其他选中
  document.querySelectorAll('#image-keywords-list .style-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  // 更新 prompt
  const promptEl = document.getElementById('image-prompt-input');
  const titleEl = document.getElementById('result-title-header');
  const title = (titleEl?.textContent || '').trim();
  if (promptEl) promptEl.value = `${title ? title + '，' : ''}${kw}，微信公众号配图，简洁专业，写实风格，高清画质`;
}

/** 执行生图 */
async function doGenImages() {
  const modelEl   = document.getElementById('image-model-select');
  const sizeEl    = document.getElementById('image-size-select');
  const countEl   = document.getElementById('image-count-select');
  const promptEl  = document.getElementById('image-prompt-input');
  const progressEl = document.getElementById('image-gen-progress');
  const progressText = document.getElementById('image-gen-progress-text');
  const doBtn     = document.getElementById('btn-do-gen-image');
  const insertBtn = document.getElementById('btn-insert-images');
  const wrap      = document.getElementById('image-results-wrap');
  const grid      = document.getElementById('image-results-grid');

  const model  = modelEl?.value  || 'Kwai-Kolors/Kolors';
  const size   = sizeEl?.value   || '1024x640';
  const count  = parseInt(countEl?.value || '3', 10);
  const prompt = promptEl?.value?.trim() || '';

  if (!prompt) { showToast('请先填写图片描述或分析关键词', 'warning'); return; }

  const [width, height] = size.split('x').map(Number);

  // 显示进度
  if (progressEl) progressEl.style.display = 'block';
  if (doBtn)      doBtn.disabled = true;
  if (wrap)       wrap.style.display = 'none';
  if (insertBtn)  insertBtn.style.display = 'none';
  _imagePanelResults = [];
  _imagePanelSelected = new Set();

  let done = 0;
  const updateProgress = () => {
    if (progressText) progressText.textContent = `AI 生成中… (${done}/${count}) 请稍候`;
  };
  updateProgress();

  // 并发生成
  const tasks = Array.from({ length: count }, async (_, i) => {
    try {
      const r = await fetch('/api/gen-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, width, height, model }),
      });
      const result = await r.json();
      done++;
      updateProgress();
      if (result.url) {
        _imagePanelResults.push({ url: result.url, prompt });
        return result.url;
      } else {
        console.warn('[doGenImages] 失败:', result.error);
        return null;
      }
    } catch (e) {
      done++;
      updateProgress();
      return null;
    }
  });

  await Promise.all(tasks);

  if (progressEl) progressEl.style.display = 'none';
  if (doBtn)      doBtn.disabled = false;

  if (!_imagePanelResults.length) {
    showToast('所有图片生成失败，请检查 API Key 和模型配置', 'error');
    return;
  }

  // 渲染缩略图
  if (grid) {
    grid.innerHTML = _imagePanelResults.map((img, i) => `
      <div class="image-thumb-card ${i === 0 ? 'selected' : ''}" data-idx="${i}" onclick="toggleImageSelect(this, ${i})"
        style="position:relative;border-radius:8px;overflow:hidden;border:2px solid ${i === 0 ? 'var(--accent)' : 'var(--border)'};cursor:pointer;aspect-ratio:16/10">
        <img src="${img.url}" alt="配图${i+1}" style="width:100%;height:100%;object-fit:cover;display:block">
        <div class="image-check-mark" style="position:absolute;top:4px;right:4px;width:20px;height:20px;border-radius:50%;background:${i === 0 ? 'var(--accent)' : '#fff'};border:2px solid ${i === 0 ? 'var(--accent)' : '#ccc'};display:flex;align-items:center;justify-content:center;font-size:12px;color:white">
          ${i === 0 ? '✓' : ''}
        </div>
      </div>
    `).join('');
    // 默认选中第一张
    _imagePanelSelected.add(0);
  }

  if (wrap)      wrap.style.display = 'block';
  if (insertBtn) insertBtn.style.display = '';
}

/** 切换图片选中状态 */
function toggleImageSelect(cardEl, idx) {
  if (_imagePanelSelected.has(idx)) {
    _imagePanelSelected.delete(idx);
    cardEl.style.borderColor = 'var(--border)';
    const check = cardEl.querySelector('.image-check-mark');
    if (check) { check.style.background = '#fff'; check.style.borderColor = '#ccc'; check.textContent = ''; }
  } else {
    _imagePanelSelected.add(idx);
    cardEl.style.borderColor = 'var(--accent)';
    const check = cardEl.querySelector('.image-check-mark');
    if (check) { check.style.background = 'var(--accent)'; check.style.borderColor = 'var(--accent)'; check.textContent = '✓'; }
  }
}

/** 将选中图片插入文章 */
function insertSelectedImages() {
  if (!_imagePanelSelected.size) { showToast('请先选择至少一张图片', 'warning'); return; }
  const container = document.getElementById('result-content');
  if (!container) return;

  const selected = Array.from(_imagePanelSelected).sort((a,b)=>a-b).map(i => _imagePanelResults[i]).filter(Boolean);

  // 尝试插入到配图占位槽
  const slots = Array.from(container.querySelectorAll('.img-placeholder'));
  let insertedToSlots = 0;

  if (slots.length > 0) {
    // 按顺序替换占位槽（v3.0.4 美学优化：增大圆角、添加阴影）
    selected.forEach((img, i) => {
      if (i < slots.length) {
        const slot = slots[i];
        slot.removeAttribute('data-sf-loading');
        slot.style.cssText = 'width:100%;border-radius:12px;overflow:hidden;margin:24px 0;box-shadow:0 4px 16px rgba(0,0,0,0.08);';
        const imgEl = document.createElement('img');
        imgEl.src = img.url;
        imgEl.alt = '配图';
        imgEl.style.cssText = 'width:100%;height:auto;display:block;border-radius:12px;';
        slot.innerHTML = '';
        slot.appendChild(imgEl);
        insertedToSlots++;
      }
    });
    // 剩余图片追加到文章末尾
    const remaining = selected.slice(slots.length);
    remaining.forEach(img => {
      const div = document.createElement('div');
      div.style.cssText = 'width:100%;border-radius:12px;overflow:hidden;margin:24px 0;box-shadow:0 4px 16px rgba(0,0,0,0.08);';
      const imgEl = document.createElement('img');
      imgEl.src = img.url; imgEl.alt = '配图';
      imgEl.style.cssText = 'width:100%;height:auto;display:block;border-radius:12px;';
      div.appendChild(imgEl);
      container.appendChild(div);
    });
  } else {
    // 无占位槽，直接追加到文章末尾（v3.0.4 美学优化）
    selected.forEach(img => {
      const div = document.createElement('div');
      div.style.cssText = 'width:100%;border-radius:12px;overflow:hidden;margin:24px 0;box-shadow:0 4px 16px rgba(0,0,0,0.08);';
      const imgEl = document.createElement('img');
      imgEl.src = img.url; imgEl.alt = '配图';
      imgEl.style.cssText = 'width:100%;height:auto;display:block;border-radius:12px;';
      div.appendChild(imgEl);
      container.appendChild(div);
    });
  }

  // 关闭面板
  closeImagePanel();
  showToast(`${selected.length} 张配图已插入文章`, 'success');

  // 同步预览
  const titleHeader = document.getElementById('result-title-header');
  if (titleHeader) refreshPreviewHTML(titleHeader.textContent, container.innerHTML);

  // v3.0.2 修复：配图插入后立即保存草稿到 localStorage
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      const draft = JSON.parse(raw);
      // 保存包含配图的完整 HTML
      _saveArticleDraft({
        ...draft,
        content: container.innerHTML, // 保存 innerHTML 而不是 innerText
        savedAt: Date.now(),
      });
      console.log('[配图保存] 已更新草稿，包含 ' + selected.length + ' 张配图');
    }
  } catch(e) {
    console.error('[配图保存] 失败：', e);
  }
}



function writeAgain() {
  const wr = document.getElementById('write-result');
  const pa = document.getElementById('write-progress-area');
  if (wr) wr.style.display = 'none';
  if (pa) pa.style.display = 'none';
  // v3.0.1：step1/step2 始终可见，无需重新显示
  // 还原微信预览为空白状态
  const headerEl  = document.getElementById('wx-side-header');
  const bodyEl    = document.getElementById('wx-preview-body');
  const actionsEl = document.getElementById('wx-side-actions');
  const emptyEl   = document.getElementById('wx-empty-placeholder');
  if (headerEl)  headerEl.style.display  = 'none';
  if (actionsEl) actionsEl.style.display = 'none';
  if (bodyEl && emptyEl) {
    bodyEl.innerHTML = emptyEl.outerHTML;
    document.getElementById('wx-empty-placeholder').style.display = '';
  }
  [1, 2, 3, 4].forEach(n => setWriteStep(n, ''));
}

/** v2.9.9：返回搜索区（保留文章内容，只展示 step1/step2，隐藏文稿 panel） */
function backToSearch() {
  const wr      = document.getElementById('write-result');
  const s1      = document.getElementById('write-step1');
  const s2      = document.getElementById('write-step2');
  const newsEl  = document.getElementById('news-list');

  if (wr) wr.style.display = 'none';
  if (s1) s1.style.display = '';

  // v2.9.9 修复：恢复搜索结果列表
  if (newsEl && state.fetchedArticles && state.fetchedArticles.length) {
    // 重新渲染 news-list（fetchNews 渲染后 display:none 未恢复）
    const count = parseInt((document.getElementById('count-select') || {}).value || '5', 10);
    newsEl.innerHTML = state.fetchedArticles.map((a, i) => `
      <div class="news-item ${state.selectedArticles.includes(i) ? 'checked' : ''}" id="news-${i}" onclick="toggleNews(${i})">
        <input type="checkbox" id="chk-${i}" ${state.selectedArticles.includes(i) ? 'checked' : ''} onclick="event.stopPropagation();toggleNews(${i})" />
        <div class="news-item-title">${escHtml(a.title)}</div>
        <div class="news-item-source">${escHtml(a.source || '')}</div>
      </div>
    `).join('');
    newsEl.style.display = '';
    if (s2) s2.style.display = '';
  } else {
    // 没有搜索结果则隐藏 step2（引导用户先搜索）
    if (s2) s2.style.display = 'none';
  }

  // 滚动回顶部，便于看到搜索框
  const writeCol = document.querySelector('.write-col-main');
  if (writeCol) writeCol.scrollTop = 0;
  showToast('已返回搜索区，文章内容已保留');
}

// ════════════════════════════════════════════════════════
// v2.9.8 草稿自动保存 / 恢复 / 清除
// ════════════════════════════════════════════════════════
const DRAFT_KEY = 'waw_article_draft_v1';

function _saveArticleDraft(draftObj) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draftObj));
    const ind = document.getElementById('draft-save-indicator');
    if (ind) { ind.style.display = 'inline-flex'; }
  } catch (e) {}
}

/** 页面加载时，如有草稿则恢复显示 */
function _tryRestoreArticleDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const draft = JSON.parse(raw);
    if (!draft || !draft.content) return;

    // 只在 write 页面恢复
    if (state.currentPage !== 'write') return;

    // 检查离上次保存是否超过 7 天
    const ageDays = (Date.now() - (draft.savedAt || 0)) / 86400000;
    if (ageDays > 7) { localStorage.removeItem(DRAFT_KEY); return; }

    // v3.0.1：step1/step2 始终可见，不再折叠，直接显示文稿区

    const resultEl = document.getElementById('write-result');
    const contentEl = document.getElementById('result-content');
    const titleEl = document.getElementById('result-title-header');
    const wcEl = document.getElementById('result-wordcount');
    const tagsEl = document.getElementById('result-tags');
    const ind = document.getElementById('draft-save-indicator');

    if (resultEl) resultEl.style.display = 'flex';
    if (titleEl)  titleEl.textContent = draft.title || '（草稿）';
    if (wcEl)     wcEl.textContent = '约 ' + (draft.wordCount || 0) + ' 字';
    if (tagsEl)   tagsEl.innerHTML = (draft.tags || []).map(t => `<span class="tag-chip">${escHtml(t)}</span>`).join('');
    if (ind) {
      ind.style.display = 'inline-flex';
      const d = new Date(draft.savedAt);
      ind.title = `保存于 ${d.toLocaleString()}`;
    }

    if (contentEl) {
      let html = typeof marked !== 'undefined' ? marked.parse(draft.content) : draft.content.replace(/\n/g,'<br>');

      // v3.0.4 美学优化：添加精致配图占位槽到中栏（与 renderArticleResult 保持一致）
      let imgSlotIdx = 0;
      const makeImgSlot = (sectionTitle) => {
        imgSlotIdx++;
        return `<div class="img-placeholder" style="width:100%;height:140px;background:linear-gradient(135deg,#f0f8f8 0%,#e0f0f0 100%);display:flex;align-items:center;justify-content:center;border-radius:12px;margin:20px 0;color:#148085;font-size:13px;border:2px dashed #b8d8d8;opacity:0.85;box-shadow:0 2px 8px rgba(20,128,133,0.06);">
          <span style="background:#fff;padding:8px 16px;border-radius:20px;box-shadow:0 2px 6px rgba(20,128,133,0.1);">📷 配图区域 · ${escHtml(sectionTitle)}</span></div>`;
      };
      html = html.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (match, content) => {
        const cleanContent = content.replace(/^\s*\d{1,2}[\s\.\:：\-]+\s*/, '').trim();
        return match + makeImgSlot(cleanContent);
      });

      contentEl.innerHTML = html;
      // 绑定实时同步（防止重复绑定）
      if (!contentEl._syncBound) {
        contentEl._syncBound = true;
        let syncTimer = null;
        contentEl.addEventListener('input', () => {
          clearTimeout(syncTimer);
          syncTimer = setTimeout(() => {
            const t = document.getElementById('result-title-header')?.textContent || '';
            refreshPreviewHTML(t, contentEl.innerHTML);
            // 持续保存编辑内容
            _saveArticleDraft({ ...draft, content: contentEl.innerText, savedAt: Date.now() });
          }, 800);
        });
      }
      refreshPreview(draft.title || '', draft.content);
    }

    showToast('已恢复上次草稿（' + (ageDays < 1 ? '今天' : Math.floor(ageDays) + '天前') + '）', 'info');
  } catch (e) {}
}

/** 手动清除草稿 */
function clearArticleDraft() {
  localStorage.removeItem(DRAFT_KEY);
  // 重置界面
  writeAgain();
  const ind = document.getElementById('draft-save-indicator');
  if (ind) ind.style.display = 'none';
  showToast('草稿已清除', 'success');
}

// ════════════════════════════════════════════════════════
// 文章排版格式化（左栏中栏编辑区 — v2.9.6 加入配图占位符）
// ════════════════════════════════════════════════════════
function formatSectionHeadings(html) {
  let sectionCount = 0;
  return html.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (match, content) => {
    sectionCount++;
    const num = String(sectionCount).padStart(2, '0');
    // v2.9.6：去掉 AI 可能带入的数字前缀，避免重复（如 "03 标题" → "标题"）
    const cleanContent = content.replace(/^\s*\d{1,2}[\s\.\:：\-]+\s*/, '').trim();
    // 错位叠放：序号大字 + 色块标题 + 配图占位符（v2.9.6 新增，修复 AI 配图找不到 placeholder）
    return `<div class="section-header-148085">` +
      `<div class="section-number-148085">${num}</div>` +
      `<div class="section-title-148085"><span>${cleanContent}</span></div>` +
      `</div>` +
      `<div class="img-placeholder" style="width:100%;height:180px;background:linear-gradient(135deg,#e8f4f4,#d0ebeb);display:flex;align-items:center;justify-content:center;border-radius:8px;margin:8px 0 12px;color:#148085;font-size:13px;border:1px dashed #a0d4d4;" data-section="${cleanContent}">` +
      `<span>📷 配图区域 · ${cleanContent}</span></div>`;
  });
}

// ════════════════════════════════════════════════════════
// 风格档案（多账号版）
// ════════════════════════════════════════════════════════
const profilesState = {
  list:       [],
  activeId:   'yushtang',
  activeData: null,
};

async function loadProfile() {
  const el = document.getElementById('profile-content');
  if (el) el.innerHTML = '<div class="loading-state">加载中...</div>';
  try {
    const data = await fetchJSON('/api/profiles');
    profilesState.list = data.profiles || [];
    renderProfilesTabs();
    await loadProfileDetail(profilesState.activeId);
  } catch (err) {
    if (el) el.innerHTML = '<div class="empty-state">加载失败：' + escHtml(err.message) + '</div>';
  }
}

function renderProfilesTabs() {
  const tabsEl = document.getElementById('profiles-tabs');
  if (!tabsEl) return;
  tabsEl.innerHTML = profilesState.list.map(p => `
    <button class="profile-tab ${p.id === profilesState.activeId ? 'active' : ''}"
      onclick="switchProfileTab('${escHtml(p.id)}')">
      <span>${escHtml(p.icon || '📝')}</span>
      <span>${escHtml(p.name)}</span>
      ${p.sample_count ? '<span class="profile-tab-badge">' + p.sample_count + '篇</span>' : ''}
    </button>
  `).join('');
}

async function switchProfileTab(id) {
  profilesState.activeId = id;
  renderProfilesTabs();
  await loadProfileDetail(id);
}

async function loadProfileDetail(id) {
  const el = document.getElementById('profile-content');
  if (el) el.innerHTML = '<div class="loading-state">加载中...</div>';
  try {
    const p = await fetchJSON('/api/profiles/' + id);
    profilesState.activeData = p;
    renderProfile(p);
  } catch (err) {
    if (el) {
      el.innerHTML = `
        <div class="profile-empty-state">
          <div class="profile-empty-icon">📝</div>
          <div class="profile-empty-text">此档案尚未建立风格数据</div>
          <div class="profile-empty-hint">请导入该公众号的历史文章，AI 将自动学习并建立风格档案</div>
          <button class="btn btn-primary" onclick="showImportSamplesPanel('${escHtml(id)}')">
            导入文章样本
          </button>
        </div>
      `;
    }
  }
}

function renderProfile(p) {
  const el = document.getElementById('profile-content');
  if (!el) return;

  const isDefault = p._profileId === 'yushtang';
  const canDelete = !isDefault;

  el.innerHTML = `
    <div class="profile-detail-header">
      <div class="profile-detail-meta">
        <span class="profile-detail-icon">${escHtml(p._profileIcon || '📝')}</span>
        <div>
          <div class="profile-detail-name">${escHtml(p._profileName || p._profileId || '')}</div>
          <div class="profile-detail-desc">${escHtml(p._profileDescription || '')}</div>
        </div>
      </div>
      <div class="profile-detail-actions">
        <button class="btn btn-secondary btn-sm" onclick="showImportSamplesPanel('${escHtml(p._profileId)}')">
          <svg viewBox="0 0 24 24"><path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/></svg>
          导入文章 / 迭代学习
        </button>
        ${canDelete ? `<button class="btn btn-ghost btn-sm" style="color:#f87171" onclick="deleteProfile('${escHtml(p._profileId)}', '${escHtml(p._profileName || '')}')">删除档案</button>` : ''}
      </div>
    </div>

    <!-- 导入面板（默认折叠）-->
    <div class="import-samples-panel" id="import-samples-panel-${escHtml(p._profileId)}" style="display:none">
      <div class="panel-body" style="background:#f8fafc;border-radius:12px;padding:1.25rem;margin-bottom:1.5rem;border:1px solid #e2e8f0">
        <!-- v2.9.4：导入方式 Tab -->
        <div class="import-tabs" style="margin-bottom:1rem">
          <button class="import-tab active" id="profile-tab-paste-${escHtml(p._profileId)}" onclick="switchProfileImportTab('${escHtml(p._profileId)}','paste')">📋 粘贴文章</button>
          <button class="import-tab" id="profile-tab-url-${escHtml(p._profileId)}" onclick="switchProfileImportTab('${escHtml(p._profileId)}','url')">🔗 导入链接</button>
        </div>
        <!-- 粘贴模式 -->
        <div id="profile-paste-area-${escHtml(p._profileId)}">
          <div class="form-group">
            <label class="form-label">粘贴文章正文（每篇文章之间用 "---" 分隔，或每次粘贴一篇）</label>
            <textarea class="form-textarea" id="samples-textarea-${escHtml(p._profileId)}" rows="10"
              placeholder="粘贴该公众号的历史文章正文...&#10;&#10;建议导入 5-15 篇最有代表性的文章，AI 会学习你的写作特征：用词习惯、句式风格、段落结构等。&#10;&#10;每篇文章之间用一行 --- 分隔即可。"></textarea>
            <div style="display:flex;justify-content:space-between;margin-top:0.5rem">
              <span style="font-size:0.8rem;color:#94a3b8" id="samples-count-${escHtml(p._profileId)}">0 字</span>
              <label style="font-size:0.8rem;color:#94a3b8;cursor:pointer">
                <input type="file" accept=".txt,.md" multiple style="display:none"
                  onchange="loadSamplesFromFiles(event, '${escHtml(p._profileId)}')">
                📁 或上传 TXT 文件
              </label>
            </div>
          </div>
          <div class="btn-row">
            <button class="btn btn-primary" onclick="analyzeSamples('${escHtml(p._profileId)}')">
              <svg viewBox="0 0 24 24"><path d="M12 3L1 9l11 6 9-4.91V17h2V9L12 3zM5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82z"/></svg>
              开始分析 / 迭代风格
            </button>
            <button class="btn btn-ghost" onclick="document.getElementById('import-samples-panel-${escHtml(p._profileId)}').style.display='none'">收起</button>
          </div>
        </div>
        <!-- 链接模式（v2.9.4） -->
        <div id="profile-url-area-${escHtml(p._profileId)}" style="display:none">
          <div class="form-group">
            <label class="form-label">文章链接（支持批量，每行一个）</label>
            <textarea class="form-textarea" id="profile-url-input-${escHtml(p._profileId)}" rows="5"
              placeholder="每行输入一个文章链接，可同时导入多篇&#10;例如：&#10;https://mp.weixin.qq.com/s/xxx&#10;https://www.example.com/article/123"></textarea>
          </div>
          <div id="profile-url-status-${escHtml(p._profileId)}" style="display:none;margin-bottom:8px;font-size:13px;color:#148085;padding:8px 12px;background:#f0fdfa;border-radius:6px;border:1px solid #99f6e4"></div>
          <div class="btn-row">
            <button class="btn btn-primary" onclick="fetchProfileFromUrls('${escHtml(p._profileId)}')">
              <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
              解析链接并导入
            </button>
            <button class="btn btn-ghost" onclick="document.getElementById('import-samples-panel-${escHtml(p._profileId)}').style.display='none'">收起</button>
          </div>
        </div>
        <div id="analyze-progress-${escHtml(p._profileId)}" style="display:none;margin-top:0.75rem">
          <div class="write-progress-msg" id="analyze-msg-${escHtml(p._profileId)}"></div>
        </div>
      </div>
    </div>

    <div class="profile-grid">
      <div class="profile-card profile-summary">
        <div class="profile-card-title">风格总结</div>
        <div class="profile-summary-text">${escHtml(p.summary || '尚未分析')}</div>
      </div>
      <div class="profile-card">
        <div class="profile-card-title">语气特征</div>
        <div class="profile-kv"><div class="profile-key">整体描述</div><div class="profile-val">${escHtml(p.tone && p.tone.description || '-')}</div></div>
        <div class="profile-kv"><div class="profile-key">关键词</div><div class="chip-group">${((p.tone && p.tone.keywords) || []).map(k => '<span class="chip accent">' + escHtml(k) + '</span>').join('')}</div></div>
        <div class="profile-kv"><div class="profile-key">正式程度</div><div class="profile-val">${escHtml(p.tone && p.tone.formality || '-')}</div></div>
        <div class="profile-kv"><div class="profile-key">情感强度</div><div class="profile-val">${escHtml(p.tone && p.tone.emotion || '-')}</div></div>
      </div>
      <div class="profile-card">
        <div class="profile-card-title">写作视角</div>
        <div class="profile-kv"><div class="profile-key">叙述视角</div><div class="profile-val">${escHtml(p.perspective && p.perspective.viewpoint || '-')}</div></div>
        <div class="profile-kv"><div class="profile-key">观点立场</div><div class="profile-val">${escHtml(p.perspective && p.perspective.stance || '-')}</div></div>
        <div class="profile-kv"><div class="profile-key">文章类型</div><div class="profile-val">${escHtml(p.perspective && p.perspective.style || '-')}</div></div>
      </div>
      <div class="profile-card">
        <div class="profile-card-title">文章结构</div>
        <div class="profile-kv"><div class="profile-key">开篇方式</div><div class="profile-val">${escHtml(p.structure && p.structure.opening_style || '-')}</div></div>
        <div class="profile-kv"><div class="profile-key">正文逻辑</div><div class="profile-val">${escHtml(p.structure && p.structure.body_logic || '-')}</div></div>
        <div class="profile-kv"><div class="profile-key">结尾方式</div><div class="profile-val">${escHtml(p.structure && p.structure.closing_style || '-')}</div></div>
        <div class="profile-kv"><div class="profile-key">段落长度</div><div class="profile-val">${escHtml(p.structure && p.structure.paragraph_length || '-')}</div></div>
      </div>
      <div class="profile-card">
        <div class="profile-card-title">语言特征</div>
        <div class="profile-kv"><div class="profile-key">词汇风格</div><div class="profile-val">${escHtml(p.language && p.language.vocabulary_level || '-')}</div></div>
        <div class="profile-kv"><div class="profile-key">句子长度</div><div class="profile-val">${escHtml(p.language && p.language.sentence_length || '-')}</div></div>
        <div class="profile-kv"><div class="profile-key">常用修辞</div><div class="chip-group">${((p.language && p.language.rhetorical_devices) || []).map(k => '<span class="chip">' + escHtml(k) + '</span>').join('')}</div></div>
        <div class="profile-kv"><div class="profile-key">标志性表达</div><div class="chip-group">${((p.language && p.language.signature_expressions) || []).map(k => '<span class="chip accent">' + escHtml(k) + '</span>').join('')}</div></div>
      </div>
      <div class="profile-card">
        <div class="profile-card-title">内容偏好</div>
        <div class="profile-kv"><div class="profile-key">常写主题</div><div class="chip-group">${((p.content && p.content.themes) || []).map(k => '<span class="chip accent">' + escHtml(k) + '</span>').join('')}</div></div>
        <div class="profile-kv"><div class="profile-key">内容深度</div><div class="profile-val">${escHtml(p.content && p.content.depth || '-')}</div></div>
        <div class="profile-kv"><div class="profile-key">数据使用</div><div class="profile-val">${escHtml(p.content && p.content.data_usage || '-')}</div></div>
        <div class="profile-kv"><div class="profile-key">举例方式</div><div class="profile-val">${escHtml(p.content && p.content.example_style || '-')}</div></div>
      </div>
      <div class="profile-card" style="grid-column:1/-1">
        <div class="profile-card-title">AI 写作指令（核心）</div>
        <div class="instruction-box">${escHtml(p.writing_instructions || '尚未建立')}</div>
      </div>
      ${p.sample_sentences && p.sample_sentences.length ? `
      <div class="profile-card" style="grid-column:1/-1">
        <div class="profile-card-title">代表性句子</div>
        <ul class="sentence-list">${p.sample_sentences.map(s => '<li>' + escHtml(s) + '</li>').join('')}</ul>
      </div>` : ''}
      ${p._meta ? `
      <div class="profile-card">
        <div class="profile-card-title">档案元信息</div>
        <div class="profile-kv"><div class="profile-key">分析时间</div><div class="profile-val">${escHtml((p._meta.analyzed_at || '').substring(0, 10) || '-')}</div></div>
        <div class="profile-kv"><div class="profile-key">累计样本</div><div class="profile-val">${p._meta.sample_count || 0} 篇</div></div>
        <div class="profile-kv"><div class="profile-key">使用模型</div><div class="profile-val">${escHtml(p._meta.provider || '')} / ${escHtml(p._meta.model || '')}</div></div>
      </div>` : ''}
    </div>
  `;

  // 绑定字数统计
  const ta = document.getElementById('samples-textarea-' + p._profileId);
  const cnt = document.getElementById('samples-count-' + p._profileId);
  if (ta && cnt) {
    ta.addEventListener('input', () => {
      cnt.textContent = ta.value.replace(/\s/g, '').length + ' 字';
    });
  }
}

function showImportSamplesPanel(profileId) {
  const panel = document.getElementById('import-samples-panel-' + profileId);
  if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

// v2.9.4：风格档案导入 Tab 切换
function switchProfileImportTab(profileId, tab) {
  const pasteArea = document.getElementById('profile-paste-area-' + profileId);
  const urlArea   = document.getElementById('profile-url-area-' + profileId);
  const tabPaste  = document.getElementById('profile-tab-paste-' + profileId);
  const tabUrl    = document.getElementById('profile-tab-url-' + profileId);
  if (tab === 'paste') {
    if (pasteArea) pasteArea.style.display = '';
    if (urlArea)   urlArea.style.display   = 'none';
    if (tabPaste)  tabPaste.classList.add('active');
    if (tabUrl)    tabUrl.classList.remove('active');
  } else {
    if (pasteArea) pasteArea.style.display = 'none';
    if (urlArea)   urlArea.style.display   = '';
    if (tabPaste)  tabPaste.classList.remove('active');
    if (tabUrl)    tabUrl.classList.add('active');
  }
}

// v2.9.4：风格档案从链接批量导入
async function fetchProfileFromUrls(profileId) {
  const urlInput  = document.getElementById('profile-url-input-' + profileId);
  const statusDiv = document.getElementById('profile-url-status-' + profileId);
  const ta        = document.getElementById('samples-textarea-' + profileId);
  if (!urlInput) return;

  const urls = urlInput.value.split('\n').map(s => s.trim()).filter(s => s.startsWith('http'));
  if (!urls.length) { showToast('请至少输入一个有效的 http 链接', 'warning'); return; }

  if (statusDiv) { statusDiv.style.display = 'block'; statusDiv.textContent = `正在解析 ${urls.length} 个链接...`; }

  let successCount = 0; let failCount = 0;
  const collected = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (statusDiv) statusDiv.textContent = `正在解析第 ${i+1}/${urls.length} 个链接...`;
    try {
      const r = await fetch('/api/fetch-article', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await r.json();
      if (data.error) { failCount++; continue; }

      // v3.0.2 新增：自动保存到对应账号文件夹（如 data/zaiwang/）
      try {
        await fetch('/api/ref-articles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: data.title,
            content: data.content,
            profileId: profileId,
          }),
        });
        console.log(`✅ 已自动保存文章「${data.title}」到 ${profileId} 文件夹`);
      } catch(saveErr) {
        console.error('保存文章失败：', saveErr);
      }

      collected.push(`【${data.title}】\n\n${data.content}`);
      successCount++;
    } catch(e) { failCount++; }
  }

  if (collected.length) {
    // 追加到粘贴区（不覆盖已有内容）
    if (ta) {
      const existing = ta.value.trim();
      ta.value = existing ? existing + '\n\n---\n\n' + collected.join('\n\n---\n\n') : collected.join('\n\n---\n\n');
      const cnt = document.getElementById('samples-count-' + profileId);
      if (cnt) cnt.textContent = ta.value.replace(/\s/g, '').length + ' 字';
    }
    // 切回粘贴 tab，让用户确认后分析
    switchProfileImportTab(profileId, 'paste');
    
    // v3.0.2：自动保存文章到对应账号文件夹
    for (const articleStr of collected) {
      const titleMatch = articleStr.match(/【(.+?)】/);
      if (!titleMatch) continue;
      const title = titleMatch[1];
      const content = articleStr.replace(/【.+?】\n\n/, '');
      
      try {
        await fetch('/api/ref-articles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content, profileId }),
        });
      } catch(err) {
        console.error('保存文章失败:', err);
      }
    }
  }

  if (statusDiv) {
    statusDiv.textContent = `✅ 成功导入 ${successCount} 篇${failCount > 0 ? `，失败 ${failCount} 篇（可能需要登录或内容加密）` : ''}。已追加到粘贴区，请点击「开始分析/迭代风格」。`;
    setTimeout(() => { if (statusDiv) statusDiv.style.display = 'none'; }, 8000);
  }
}

// v2.9.4：参考仿写 Tab 切换
function switchRefTab(tab) {
  const pasteArea = document.getElementById('ref-add-area');
  const urlArea   = document.getElementById('ref-url-area');
  const tabPaste  = document.getElementById('ref-tab-paste');
  const tabUrl    = document.getElementById('ref-tab-url');
  if (tab === 'paste') {
    if (pasteArea) pasteArea.style.display = '';
    if (urlArea)   urlArea.style.display   = 'none';
    if (tabPaste)  tabPaste.classList.add('active');
    if (tabUrl)    tabUrl.classList.remove('active');
  } else {
    if (pasteArea) pasteArea.style.display = 'none';
    if (urlArea)   urlArea.style.display   = '';
    if (tabPaste)  tabPaste.classList.remove('active');
    if (tabUrl)    tabUrl.classList.add('active');
  }
}

// v2.9.4：参考仿写从链接批量导入并保存
async function fetchRefFromUrls() {
  const urlInput  = document.getElementById('ref-url-input');
  const statusDiv = document.getElementById('ref-url-status');
  const btn       = document.getElementById('btn-fetch-ref');
  if (!urlInput) return;

  const urls = urlInput.value.split('\n').map(s => s.trim()).filter(s => s.startsWith('http'));
  if (!urls.length) { showToast('请至少输入一个有效的 http 链接', 'warning'); return; }

  if (btn) { btn.disabled = true; btn.textContent = '解析中...'; }
  if (statusDiv) { statusDiv.style.display = 'block'; statusDiv.textContent = `正在解析 ${urls.length} 个链接...`; }

  let successCount = 0; let failCount = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (statusDiv) statusDiv.textContent = `正在解析第 ${i+1}/${urls.length} 个链接...`;
    try {
      const r = await fetch('/api/fetch-article', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await r.json();
      if (data.error) { failCount++; if (statusDiv) statusDiv.textContent += ` 第${i+1}篇失败：${data.error}`; continue; }

      // 直接保存为参考文章
      const saveR = await fetch('/api/ref-articles', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: data.title, content: data.content }),
      });
      const saveData = await saveR.json();
      if (saveData.error) { failCount++; continue; }
      successCount++;
    } catch(e) { failCount++; }
  }

  if (btn) { btn.disabled = false; btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg> 解析并导入'; }
  if (statusDiv) {
    statusDiv.textContent = `✅ 成功导入 ${successCount} 篇参考文章${failCount > 0 ? `，失败 ${failCount} 篇` : ''}！`;
    setTimeout(() => { if (statusDiv) statusDiv.style.display = 'none'; }, 6000);
  }
  if (urlInput) urlInput.value = '';
  loadRefArticles(); // 刷新列表（修复：原为 loadImitateRefArticles 拼写错误）
  showToast(`成功导入 ${successCount} 篇参考文章`, successCount > 0 ? 'success' : 'error');
}



function loadSamplesFromFiles(event, profileId) {
  const files = Array.from(event.target.files);
  const ta = document.getElementById('samples-textarea-' + profileId);
  if (!ta || !files.length) return;

  Promise.all(files.map(f => f.text())).then(texts => {
    ta.value = texts.join('\n\n---\n\n');
    const cnt = document.getElementById('samples-count-' + profileId);
    if (cnt) cnt.textContent = ta.value.replace(/\s/g, '').length + ' 字';
    showToast('已加载 ' + files.length + ' 个文件');
  });
}

async function analyzeSamples(profileId) {
  const ta = document.getElementById('samples-textarea-' + profileId);
  const text = ta ? ta.value.trim() : '';
  if (!text || text.length < 100) { showToast('文章样本太少，请粘贴更多内容', 'error'); return; }

  // 按 --- 分割多篇文章
  const rawSamples = text.split(/\n[-—]{3,}\n/).map(s => s.trim()).filter(s => s.length > 50);
  if (!rawSamples.length) { showToast('未识别到有效文章，请确保每篇之间用 "---" 分隔', 'error'); return; }

  const samples = rawSamples.map((content, i) => {
    const lines = content.split('\n');
    const title = lines[0].replace(/^#\s*/, '').trim().substring(0, 50) || ('样本 ' + (i+1));
    return { title, content };
  });

  const progressEl = document.getElementById('analyze-progress-' + profileId);
  const msgEl      = document.getElementById('analyze-msg-' + profileId);
  if (progressEl) progressEl.style.display = 'block';
  if (msgEl) msgEl.textContent = '正在连接 AI 分析...';

  try {
    const resp = await fetch('/api/profiles/' + profileId + '/analyze', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ samples, merge: true }),
    });
    if (!resp.ok) throw new Error('服务器错误 ' + resp.status);
    if (!resp.body) throw new Error('浏览器不支持流式读取');

    const reader  = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const msg = JSON.parse(line.slice(5).trim());
        if (msg.type === 'progress') {
          if (msgEl) msgEl.textContent = msg.msg;
        }
        if (msg.__done) {
          if (msg.error) {
            showToast('分析失败：' + msg.error, 'error');
            if (msgEl) msgEl.textContent = '⚠️ ' + msg.error;
          } else {
            showToast('风格分析完成，档案已更新！', 'success');
            profilesState.activeData = msg.profile;
            // 更新列表中的样本数
            const idx = profilesState.list.findIndex(p => p.id === profileId);
            if (idx !== -1) profilesState.list[idx].sample_count = msg.profile._meta?.sample_count || 0;
            renderProfilesTabs();
            renderProfile(msg.profile);
            // 同步更新仿写页面的自定义风格选项
            loadCustomProfileOptions();
          }
        }
      }
    }
  } catch (err) {
    showToast('分析失败：' + err.message, 'error');
    if (msgEl) msgEl.textContent = '⚠️ ' + err.message;
  }
}

// 新建档案弹窗
function showCreateProfileModal() {
  const modal = document.getElementById('create-profile-modal');
  if (modal) modal.classList.add('open');
}

function closeCreateProfileModal(e) {
  const modal = document.getElementById('create-profile-modal');
  if (e.target === modal) modal.classList.remove('open');
}

async function createProfile() {
  const name = (document.getElementById('new-profile-name') || {}).value.trim();
  const icon = (document.getElementById('new-profile-icon') || {}).value.trim() || '📝';
  const desc = (document.getElementById('new-profile-desc') || {}).value.trim();
  if (!name) { showToast('请填写档案名称', 'error'); return; }

  try {
    const data = await fetchJSON('/api/profiles', { method: 'POST', body: { name, icon, description: desc } });
    showToast('「' + name + '」档案已创建');
    document.getElementById('create-profile-modal').classList.remove('open');
    ['new-profile-name','new-profile-icon','new-profile-desc'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = id === 'new-profile-icon' ? '📝' : '';
    });
    // 刷新列表
    profilesState.activeId = data.id;
    await loadProfile();
  } catch (err) {
    showToast('创建失败：' + err.message, 'error');
  }
}

async function deleteProfile(id, name) {
  if (!confirm('确认删除「' + name + '」档案？此操作不可撤销。')) return;
  try {
    await fetchJSON('/api/profiles/' + id, { method: 'DELETE' });
    showToast('已删除「' + name + '」');
    profilesState.activeId = 'yushtang';
    await loadProfile();
  } catch (err) {
    showToast('删除失败：' + err.message, 'error');
  }
}



// ════════════════════════════════════════════════════════
// 历史文章
// ════════════════════════════════════════════════════════
async function loadHistory() {
  const el = document.getElementById('history-list');
  if (el) el.innerHTML = '<div class="loading-state">加载中...</div>';
  try {
    const data  = await fetchJSON('/api/status');
    const files = data.output || [];
    if (!files.length) {
      if (el) el.innerHTML = '<div class="empty-state">暂无已生成文章</div>';
      return;
    }
    if (el) {
      el.innerHTML = files.map(f => `
        <div class="article-item" onclick="openArticleFromHistory('${f.name}')">
          <div class="article-item-icon">📄</div>
          <div class="article-item-body">
            <div class="article-item-title">${escHtml(f.title)}</div>
            <div class="article-item-meta">${(f.mtime || '').substring(0, 16).replace('T', ' ')} · ${formatSize(f.size)}</div>
          </div>
          <div class="article-item-arrow">›</div>
        </div>
      `).join('');
    }
  } catch (err) {
    if (el) el.innerHTML = '<div class="empty-state" style="color:#f87171">加载失败：' + escHtml(err.message) + '</div>';
  }
}

async function openArticleFromHistory(filename) {
  try {
    const data = await fetchJSON('/api/output/' + encodeURIComponent(filename));
    const raw  = data.content || '';
    const titleMatch = raw.match(/^#\s+(.+)/m);
    const title = titleMatch ? titleMatch[1].trim() : filename.replace(/\.[^.]+$/, '');

    const modalTitle = document.getElementById('modal-title');
    if (modalTitle) modalTitle.textContent = title;

    const contentEl = document.getElementById('modal-content');
    if (contentEl) {
      let html = typeof marked !== 'undefined' ? marked.parse(raw) : raw.replace(/\n/g, '<br>');
      html = formatSectionHeadings(html);
      contentEl.innerHTML = html;
    }

    const modal = document.getElementById('article-modal');
    if (modal) modal.classList.add('open');
  } catch (err) {
    showToast('打开失败：' + err.message, 'error');
  }
}

function closeArticleModal() {
  const modal = document.getElementById('article-modal');
  if (modal) modal.classList.remove('open');
}

function closeModal(e) {
  const modal = document.getElementById('article-modal');
  if (e.target === modal) closeArticleModal();
}

// ════════════════════════════════════════════════════════
// AI 状态检测
// ════════════════════════════════════════════════════════
async function checkAIStatus() {
  const dot  = document.getElementById('ai-status-dot');
  const text = document.getElementById('ai-status-text');
  try {
    const cfg = await fetchJSON('/api/config');
    if (dot) dot.className = 'status-dot ok';
    if (text) text.textContent = cfg.provider + ' · ' + cfg.model;
  } catch (err) {
    if (dot) dot.className = 'status-dot err';
    if (text) text.textContent = '配置加载失败';
  }
}

// ════════════════════════════════════════════════════════
// AI 提供商切换  v2.9.5（安全加固：掩码展示 + 保存正则修复）
// ════════════════════════════════════════════════════════

/** 当前模态框里用户选中的 provider（临时状态） */
let _pendingProvider = null;
/** 当前 sf key 是否已配置（来自服务端状态，不含明文） */
let _sfKeyConfigured = false;
/** v2.9.7：当前选中的 sf 模型 */
let _pendingSfModel = 'deepseek-ai/DeepSeek-V3';
/** v2.9.7：当前选中的 sf 模型 tab 分组 */
let _sfModelGroup = 'deepseek';
/** v2.9.9：各 provider key 配置状态 { deepseek: bool, tongyi: bool, wenxin: bool } */
let _providerKeyStatus = {};

// ─── v2.9.7 硅基流动模型库 ──────────────────────────────────────────
const SF_MODELS = {
  deepseek: [
    { id: 'deepseek-ai/DeepSeek-V3',          name: 'DeepSeek-V3',           tag: '推荐 · 超强' },
    { id: 'deepseek-ai/DeepSeek-V3-0324',     name: 'DeepSeek-V3-0324',      tag: '最新版' },
    { id: 'deepseek-ai/DeepSeek-R1',          name: 'DeepSeek-R1',           tag: '推理增强' },
    { id: 'deepseek-ai/DeepSeek-R1-0528',     name: 'DeepSeek-R1-0528',      tag: '最新推理' },
    { id: 'deepseek-ai/DeepSeek-V2.5',        name: 'DeepSeek-V2.5',         tag: '均衡版' },
  ],
  qwen: [
    { id: 'Qwen/Qwen3-235B-A22B',             name: 'Qwen3-235B',            tag: '顶级 · 超大' },
    { id: 'Qwen/Qwen3-30B-A3B',               name: 'Qwen3-30B',             tag: '高性价比' },
    { id: 'Qwen/Qwen3-32B',                   name: 'Qwen3-32B',             tag: '均衡' },
    { id: 'Qwen/Qwen3-14B',                   name: 'Qwen3-14B',             tag: '轻量快速' },
    { id: 'Qwen/Qwen3-VL-32B-Instruct',       name: 'Qwen3-VL-32B',          tag: '视觉理解' },
    { id: 'Qwen/Qwen2.5-72B-Instruct',        name: 'Qwen2.5-72B',           tag: '上一代稳定' },
    { id: 'Qwen/Qwen2.5-7B-Instruct',         name: 'Qwen2.5-7B',            tag: '超快速' },
  ],
  glm: [
    { id: 'THUDM/GLM-4-9B-Chat',              name: 'GLM-4-9B',              tag: '中文强' },
    { id: 'zai-org/GLM-5',                    name: 'GLM-5',                 tag: '最新' },
    { id: 'zai-org/GLM-4.7',                  name: 'GLM-4.7',               tag: '推理MoE' },
    { id: 'zai-org/GLM-4.6V',                 name: 'GLM-4.6V',              tag: '视觉多模态' },
    { id: 'zai-org/GLM-4.5-Air',              name: 'GLM-4.5-Air',           tag: '轻量版' },
  ],
  kimi: [
    { id: 'moonshotai/Kimi-K2.5',             name: 'Kimi-K2.5',             tag: '长上下文' },
    { id: 'moonshotai/Kimi-K2-Instruct-0905', name: 'Kimi-K2-0905',          tag: '最新' },
    { id: 'moonshotai/Kimi-VL-A3B-Instruct',  name: 'Kimi-VL',               tag: '视觉' },
  ],
  other: [
    { id: 'meta-llama/Meta-Llama-3.1-70B-Instruct',  name: 'Llama-3.1-70B',   tag: '开源强' },
    { id: 'meta-llama/Meta-Llama-3.3-70B-Instruct',  name: 'Llama-3.3-70B',   tag: '最新开源' },
    { id: 'mistralai/Mistral-7B-Instruct-v0.3',       name: 'Mistral-7B',      tag: '轻量' },
    { id: 'google/gemma-2-27b-it',                    name: 'Gemma-2-27B',     tag: 'Google开源' },
    { id: 'stepfun-ai/Step-3.5-Flash',                name: 'Step-3.5-Flash',  tag: '快速' },
    { id: 'nex-agi/DeepSeek-V3.1-Nex-N1',             name: 'DS-V3.1-Nex',    tag: '增强版' },
  ],
};

/** 渲染 sf 模型列表 */
function _renderSfModelList(group, selectedModel) {
  const listEl = document.getElementById('sf-model-list');
  const curEl  = document.getElementById('sf-model-current-display');
  if (!listEl) return;
  const models = SF_MODELS[group] || [];
  listEl.innerHTML = models.map(m => `
    <div class="sf-model-card ${selectedModel === m.id ? 'active' : ''}" onclick="selectSfModel('${m.id}')">
      <div class="sf-model-card-name" title="${m.id}">${m.name}</div>
      <div class="sf-model-card-tag">${m.tag}</div>
    </div>
  `).join('');
  if (curEl) curEl.textContent = selectedModel || 'deepseek-ai/DeepSeek-V3';
}

/** 切换 sf 模型分组 tab */
function switchSfModelGroup(group) {
  _sfModelGroup = group;
  document.querySelectorAll('.sf-model-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.group === group);
  });
  _renderSfModelList(group, _pendingSfModel);
}

/** 选中某个模型 */
function selectSfModel(modelId) {
  _pendingSfModel = modelId;
  // 更新 UI
  document.querySelectorAll('.sf-model-card').forEach(card => {
    card.classList.toggle('active', card.onclick && card.onclick.toString().includes(modelId));
  });
  // 重新渲染当前分组（确保样式更新）
  _renderSfModelList(_sfModelGroup, _pendingSfModel);
}
// ─────────────────────────────────────────────────────────────────────

/** 切换到 sf-key 编辑模式（用户主动点击"修改"） */
function sfKeyEditMode() {
  const configuredRow = document.getElementById('sf-key-configured-row');
  const inputRow      = document.getElementById('sf-key-input-row');
  const hint          = document.getElementById('sf-key-edit-hint');
  if (configuredRow) configuredRow.style.display = 'none';
  if (inputRow)      inputRow.style.display      = '';
  if (hint)          hint.style.display          = '';
  const inp = document.getElementById('sf-api-key-input');
  if (inp) { inp.value = ''; inp.focus(); }
}

/** v2.9.8+：简化 SF Key 区域展示（始终可见，去掉模型选择器） */
function _renderSfKeySection(provider, sfKeyConfigured, maskedKey) {
  const configuredRow = document.getElementById('sf-key-configured-row');
  const inputRow      = document.getElementById('sf-key-input-row');
  const maskedDisplay = document.getElementById('sf-key-masked-display');
  const hint          = document.getElementById('sf-key-edit-hint');

  if (sfKeyConfigured && maskedKey) {
    if (maskedDisplay)  maskedDisplay.textContent = '✓ 已配置：' + maskedKey;
    if (configuredRow)  configuredRow.style.display = 'flex';
    if (inputRow)       inputRow.style.display = 'none';
    if (hint)           hint.style.display = 'none';
  } else {
    if (configuredRow)  configuredRow.style.display = 'none';
    if (inputRow)       inputRow.style.display = '';
    if (hint)           hint.style.display = 'none';
    const inp = document.getElementById('sf-api-key-input');
    if (inp) inp.value = '';
  }
}

/** 打开 Provider 模态框，初始化当前选中状态 */
async function openProviderModal() {
  const modal = document.getElementById('provider-modal');
  if (!modal) return;
  try {
    const cfg = await fetchJSON('/api/config');
    _pendingProvider = cfg.provider || 'deepseek';
    _sfKeyConfigured = !!cfg.sf_key_configured;
    // 获取各 provider 掩码状态
    let maskedKey = null;
    try {
      const kStatus = await fetchJSON('/api/config/key-status');
      maskedKey = kStatus.siliconflow?.masked || null;
      // v2.9.9：记录各 provider 是否已配置
      _providerKeyStatus = {
        deepseek:    !!(kStatus.deepseek?.configured),
        tongyi:      !!(kStatus.tongyi?.configured),
        wenxin:      !!(kStatus.wenxin?.configured),
        siliconflow: !!(kStatus.siliconflow?.configured),
      };
      // 回显各 provider 的 status 文字
      ['deepseek','tongyi','wenxin'].forEach(p => {
        const statusEl = document.getElementById(p + '-key-status');
        if (statusEl) statusEl.textContent = _providerKeyStatus[p] ? '✓ 已配置' : '';
      });
    } catch (e) {}
    document.querySelectorAll('.provider-card').forEach(card => {
      card.classList.toggle('active', card.dataset.provider === _pendingProvider);
    });
    _renderSfKeySection(_pendingProvider, _sfKeyConfigured, maskedKey);
    // v2.9.9：初始化 key 输入区
    _renderProviderKeySection(_pendingProvider);
  } catch (e) {
    _pendingProvider = 'deepseek';
    _sfKeyConfigured = false;
    document.querySelectorAll('.provider-card').forEach(card => {
      card.classList.toggle('active', card.dataset.provider === _pendingProvider);
    });
    _renderSfKeySection(_pendingProvider, false, null);
    _renderProviderKeySection(_pendingProvider);
  }
  modal.classList.add('open');
}

/** 点击遮罩关闭 */
function closeProviderModal(e) {
  const modal = document.getElementById('provider-modal');
  if (modal && e.target === modal) modal.classList.remove('open');
}

/** 点击卡片高亮选中 */
function selectProvider(p) {
  _pendingProvider = p;
  document.querySelectorAll('.provider-card').forEach(card => {
    card.classList.toggle('active', card.dataset.provider === p);
  });
  // 获取当前掩码文字（避免重新请求接口）
  let maskedKey = null;
  const maskedDisplay = document.getElementById('sf-key-masked-display');
  if (maskedDisplay && maskedDisplay.textContent) {
    const m = maskedDisplay.textContent.match(/sk-\S+/);
    if (m) maskedKey = m[0];
  }
  _renderSfKeySection(p, _sfKeyConfigured, maskedKey);

  // v2.9.9：切换时展示对应 provider 的 Key 输入区
  _renderProviderKeySection(p);
}

/** v2.9.9：根据选中的 provider 显示对应的 API Key 配置区 */
function _renderProviderKeySection(provider) {
  // siliconflow 的 Key 由顶部硅基流动专区处理，provider-key-section 里不显示
  const PROVIDERS_WITH_KEY = ['deepseek', 'tongyi', 'wenxin'];
  PROVIDERS_WITH_KEY.forEach(p => {
    const box = document.getElementById('provider-key-' + p);
    if (box) box.style.display = (provider === p) ? 'block' : 'none';
  });
  // 如果选择了有 key 区的 provider，且已有配置，回显掩码
  if (PROVIDERS_WITH_KEY.includes(provider) && _providerKeyStatus[provider]) {
    const statusEl = document.getElementById(provider + '-key-status');
    if (statusEl) statusEl.textContent = '✓ 已配置';
  }
}

/** 保存 provider 切换 */
async function saveProvider() {
  if (!_pendingProvider) return;
  const btn = document.getElementById('btn-save-provider');
  if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
  try {
    // ── Step 1：如果 SF Key 输入框有新值，先保存 SF Key ──────────
    const inputRow = document.getElementById('sf-key-input-row');
    const isInputVisible = inputRow && inputRow.style.display !== 'none';
    if (isInputVisible) {
      const keyInput = document.getElementById('sf-api-key-input');
      const keyVal   = keyInput ? keyInput.value.trim() : '';
      if (keyVal && keyVal.startsWith('sk-')) {
        const kr = await fetch('/api/config/sf-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: keyVal }),
        });
        const kd = await kr.json();
        if (kd.error) throw new Error('Key 保存失败：' + kd.error);
        _sfKeyConfigured = true;
        // v2.9.9 修复：填写 SF Key 后【不再强制切换到 siliconflow】
        // 用户选了什么 provider 就保存什么 provider（SF Key 可以预填，不影响选择）
      } else if (keyVal && !keyVal.startsWith('sk-')) {
        throw new Error('硅基流动 API Key 格式错误，须以 sk- 开头');
      }
      // 留空且原来已配置 → 保留原 key，继续切换
    }

    // ── Step 2：保存当前选中 provider 对应的 API Key（如果有填写）──
    const PROVIDER_KEYS = {
      deepseek: { inputId: 'deepseek-api-key-input', endpoint: '/api/config/provider-key' },
      tongyi:   { inputId: 'tongyi-api-key-input',   endpoint: '/api/config/provider-key' },
      wenxin:   { inputId: 'wenxin-api-key-input',   endpoint: '/api/config/provider-key' },
    };
    const pkConfig = PROVIDER_KEYS[_pendingProvider];
    if (pkConfig) {
      const pkInput = document.getElementById(pkConfig.inputId);
      const pkVal   = pkInput ? pkInput.value.trim() : '';
      if (pkVal) {
        // 文心一言还需要 secret key
        const extraBody = {};
        if (_pendingProvider === 'wenxin') {
          const secretInput = document.getElementById('wenxin-secret-key-input');
          extraBody.secret_key = secretInput ? secretInput.value.trim() : '';
        }
        const pr = await fetch(pkConfig.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: _pendingProvider, api_key: pkVal, ...extraBody }),
        });
        const pd = await pr.json();
        if (pd.error) throw new Error(`${_pendingProvider} Key 保存失败：${pd.error}`);
        _providerKeyStatus[_pendingProvider] = true;
      }
    }

    // ── Step 3：保存 provider 切换 ───────────────────────────────
    const r = await fetch('/api/config/provider', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: _pendingProvider }),
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error);
    document.getElementById('provider-modal').classList.remove('open');
    const providerLabel = {
      siliconflow: '硅基流动（智能路由）',
      deepseek: 'DeepSeek',
      tongyi: '通义千问',
      wenxin: '文心一言',
    }[_pendingProvider] || _pendingProvider;
    showToast(`设置已保存，当前使用 ${providerLabel}`, 'success');
    checkAIStatus();
  } catch (err) {
    showToast('保存失败：' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="margin-right:4px"><path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>保存设置`; }
  }
}

// ════════════════════════════════════════════════════════
// 异步 FLUX 配图  v2.9.3.2 静默版
// ════════════════════════════════════════════════════════

/**
 * genImagesAsync — SiliconFlow FLUX 异步配图（静默版）
 *
 * 三不准第④条硬性要求：
 *   ① 调用 API 不得引起 UI 布局跳动
 *   ② 如果用户在等待期间切换了页面，回调必须静默丢弃，不写任何 DOM
 *   ③ 严禁 document.body.appendChild，只允许写入传入的 container 内
 *
 * 静默策略：
 *   - 每个 fetch 发出前，记录"此时所在的 activePage"
 *   - fetch 返回后，再次检查 state.currentPage 和 container 是否仍在 DOM 里
 *   - 任意一项不符则静默 return，不报错、不写 DOM
 *   - 图片用 Image() 对象预加载，onload 后再替换 innerHTML，避免 src 赋值时触发 reflow
 *
 * @param {HTMLElement} container  文章内容容器（result-content / imitate-content）
 * @param {string}      titleText  文章标题
 */
async function genImagesAsync(container, titleText) {
  if (!container) return;

  // ── 静默检查一：必须在 siliconflow 模式 ──────────────
  let isSF = false;
  try {
    const cfg = await fetchJSON('/api/config');
    isSF = (cfg.provider === 'siliconflow');
  } catch (e) {}
  if (!isSF) return;

  // ── 静默检查二：容器必须仍在文档中 ──────────────────
  if (!document.body.contains(container)) return;

  const slots = container.querySelectorAll('.img-placeholder');
  if (!slots.length) return;

  // 记录发起请求时的页面（用于回调时校验）
  const originPage = state.currentPage;

  slots.forEach((slot) => {
    // 在发起 fetch 前同步读取 sectionText（避免 await 后 DOM 已被清场）
    const spanEl = slot.querySelector('span');
    const sectionText = (spanEl ? spanEl.textContent : '')
      .replace(/^📷 配图区域 · /, '').trim() || '精彩内容';
    const prompt = `${titleText}，${sectionText}，微信公众号配图，简洁专业，高清写实`;

    // 把占位槽切为 Loading 状态（只改 innerHTML，不改宽高，不触发 layout reflow）
    slot.setAttribute('data-sf-loading', '1');
    slot.innerHTML =
      `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#148085;font-size:13px;height:100%;">` +
      `<div class="img-slot-spinner"></div>` +
      `<span style="font-size:12px;opacity:.7;">AI 配图生成中…</span>` +
      `</div>`;

    // 异步请求，完全独立，互不阻塞
    fetch('/api/gen-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, width: 1024, height: 640 }),
    })
    .then(r => r.json())
    .then(result => {
      // ── 回调静默守卫 ────────────────────────────────
      // ① 页面已切换：丢弃
      if (state.currentPage !== originPage) return;
      // ② 容器已离开文档（被清场或重新渲染）：丢弃
      if (!document.body.contains(slot)) return;
      // ③ slot 已被其他逻辑重置（data-sf-loading 不存在）：丢弃
      if (!slot.getAttribute('data-sf-loading')) return;

      if (result.url) {
        // 用 Image 对象预加载，onload 再写入，避免 src 空白期触发 reflow
        const img = new Image();
        img.onload = () => {
          // 再次检查（图片加载也需要时间）
          if (state.currentPage !== originPage) return;
          if (!document.body.contains(slot)) return;
          slot.removeAttribute('data-sf-loading');
          slot.innerHTML = '';
          slot.style.cssText = 'width:100%;height:200px;border-radius:8px;overflow:hidden;margin:12px 0 16px;';
          const imgEl = document.createElement('img');
          imgEl.src = result.url;
          imgEl.alt = sectionText;
          imgEl.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;border-radius:8px;';
          slot.appendChild(imgEl);
        };
        img.onerror = () => {
          if (!document.body.contains(slot)) return;
          slot.removeAttribute('data-sf-loading');
          slot.innerHTML = `<span>📷 配图区域 · ${escHtml(sectionText)}</span>`;
        };
        img.src = result.url;
      } else {
        // API 返回错误，静默恢复占位文字
        slot.removeAttribute('data-sf-loading');
        slot.innerHTML = `<span>📷 配图区域 · ${escHtml(sectionText)}</span>`;
      }
    })
    .catch(() => {
      // 网络错误，静默恢复占位文字
      if (!document.body.contains(slot)) return;
      slot.removeAttribute('data-sf-loading');
      slot.innerHTML = `<span>📷 配图区域 · ${escHtml(sectionText)}</span>`;
    });
  });
}



// ════════════════════════════════════════════════════════
// 参考文章仿写模块
// ════════════════════════════════════════════════════════
const imitateState = {
  articles:       [],
  selectedIds:    [],
  addAreaOpen:    true,
  selectedProfile:'yushtang',
  imitateMode:    'quick',
  pendingFiles:   [],   // 待上传的文件对象
};

async function loadImitate() {
  await loadRefArticles();
  bindRefContentCounter();
  loadCustomProfileOptions();
}

function bindRefContentCounter() {
  const textarea = document.getElementById('ref-content');
  const counter  = document.getElementById('ref-char-count');
  if (!textarea || textarea._bound) return;
  textarea._bound = true;
  textarea.addEventListener('input', () => {
    const len = textarea.value.replace(/\s/g, '').length;
    if (counter) {
      counter.textContent = len + ' 字';
      counter.style.color = len < 50 ? '#f87171' : len > 5000 ? '#fb923c' : '#94a3b8';
    }
  });
}

// ── 导入方式 Tab 切换 ────────────────────────────────
function switchImportTab(tab) {
  document.querySelectorAll('.import-tab').forEach(el => {
    el.classList.toggle('active', el.dataset.import === tab);
  });
  document.querySelectorAll('.import-panel').forEach(el => {
    el.classList.remove('active');
  });
  const panel = document.getElementById('import-panel-' + tab);
  if (panel) panel.classList.add('active');
}

// ── 旧接口兼容 ─────────────────────────────────────
function toggleRefAddArea() {
  switchImportTab('paste');
  const area = document.getElementById('ref-add-area');
  if (!area) return;
  const isOpen = area.style.display !== 'none';
  area.style.display = isOpen ? 'none' : 'block';
}

// ── 粘贴保存 ─────────────────────────────────────────
async function saveRefArticle() {
  const title   = document.getElementById('ref-title').value.trim();
  const content = document.getElementById('ref-content').value.trim();
  if (!title)              { showToast('请填写文章标题', 'error'); return; }
  if (content.length < 50) { showToast('正文不足 50 字', 'error'); return; }

  const btn = document.getElementById('btn-save-ref');
  setLoading(btn, true, '保存中...');
  try {
    await fetchJSON('/api/ref-articles', { method: 'POST', body: { title, content } });
    showToast('「' + title + '」保存成功');
    document.getElementById('ref-title').value   = '';
    document.getElementById('ref-content').value = '';
    const counter = document.getElementById('ref-char-count');
    if (counter) counter.textContent = '0 字';
    const area = document.getElementById('ref-add-area');
    if (area) area.style.display = 'none';
    await loadRefArticles();
  } catch (err) {
    showToast('保存失败：' + err.message, 'error');
  } finally {
    setLoading(btn, false);
  }
}

// ── 链接解析 ─────────────────────────────────────────
async function parseRefUrl() {
  const urlInput = document.getElementById('ref-url-input');
  const url = urlInput ? urlInput.value.trim() : '';
  if (!url) { showToast('请输入链接', 'error'); return; }
  if (!url.startsWith('http')) { showToast('请输入有效的 http/https 链接', 'error'); return; }

  const btn      = document.getElementById('btn-parse-url');
  const statusEl = document.getElementById('url-parse-status');
  setLoading(btn, true, '解析中...');
  if (statusEl) { statusEl.style.display = 'flex'; statusEl.textContent = '正在解析链接，请稍候...'; statusEl.className = 'url-parse-status loading'; }

  try {
    const data = await fetchJSON('/api/parse-url', { method: 'POST', body: { url } });
    const titleEl   = document.getElementById('url-parsed-title');
    const contentEl = document.getElementById('url-parsed-content');
    const countEl   = document.getElementById('url-char-count');
    const previewEl = document.getElementById('url-preview-area');

    if (titleEl)   titleEl.value   = data.title || '';
    if (contentEl) contentEl.value = data.content || '';
    if (countEl)   countEl.textContent = (data.wordCount || 0) + ' 字';
    if (previewEl) previewEl.style.display = 'block';

    if (statusEl) { statusEl.textContent = '✅ 解析成功，共 ' + (data.wordCount || 0) + ' 字'; statusEl.className = 'url-parse-status success'; }
  } catch (err) {
    if (statusEl) { statusEl.textContent = '❌ ' + err.message; statusEl.className = 'url-parse-status error'; }
    showToast('解析失败：' + err.message, 'error');
  } finally {
    setLoading(btn, false);
  }
}

async function saveUrlArticle() {
  const title   = (document.getElementById('url-parsed-title')   || {}).value || '';
  const content = (document.getElementById('url-parsed-content') || {}).value || '';
  if (!title.trim())    { showToast('标题不能为空', 'error'); return; }
  if (content.length < 50) { showToast('正文不足 50 字', 'error'); return; }

  try {
    await fetchJSON('/api/ref-articles', { method: 'POST', body: { title: title.trim(), content } });
    showToast('保存成功');
    clearUrlPreview();
    await loadRefArticles();
  } catch (err) {
    showToast('保存失败：' + err.message, 'error');
  }
}

function clearUrlPreview() {
  const els = ['url-parsed-title','url-parsed-content','ref-url-input'];
  els.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const previewEl = document.getElementById('url-preview-area');
  if (previewEl) previewEl.style.display = 'none';
  const statusEl = document.getElementById('url-parse-status');
  if (statusEl) statusEl.style.display = 'none';
}

// ── 文件上传 ─────────────────────────────────────────
function handleFileUpload(event) {
  const files = Array.from(event.target.files);
  if (!files.length) return;

  imitateState.pendingFiles = files;
  const listEl    = document.getElementById('file-list');
  const previewEl = document.getElementById('file-upload-preview');
  if (listEl) {
    listEl.innerHTML = files.map((f, i) => `
      <div class="file-item">
        <svg viewBox="0 0 24 24" width="16" height="16"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
        <span class="file-name">${escHtml(f.name)}</span>
        <span class="file-size">${formatSize(f.size)}</span>
      </div>
    `).join('');
  }
  if (previewEl) previewEl.style.display = 'block';

  const dropZone = document.getElementById('file-drop-zone');
  if (dropZone) dropZone.querySelector('.file-upload-text').textContent = `已选 ${files.length} 个文件`;
}

async function saveUploadedFiles() {
  const files = imitateState.pendingFiles;
  if (!files.length) { showToast('请先选择文件', 'error'); return; }

  let saved = 0, failed = 0;
  for (const f of files) {
    try {
      const text = await f.text();
      const title = f.name.replace(/\.[^.]+$/, '');
      await fetchJSON('/api/ref-articles', { method: 'POST', body: { title, content: text } });
      saved++;
    } catch(e) {
      failed++;
    }
  }

  showToast(`批量导入完成：${saved} 篇成功${failed ? ('，' + failed + ' 篇失败') : ''}`);
  clearFileUpload();
  await loadRefArticles();
}

function clearFileUpload() {
  imitateState.pendingFiles = [];
  const input   = document.getElementById('file-upload-input');
  const preview = document.getElementById('file-upload-preview');
  const dropZone = document.getElementById('file-drop-zone');
  if (input)   input.value = '';
  if (preview) preview.style.display = 'none';
  if (dropZone) dropZone.querySelector('.file-upload-text').textContent = '点击选择或拖放 TXT 文件';
}

// ── 参考文章列表 ─────────────────────────────────────
async function loadRefArticles() {
  const el = document.getElementById('ref-article-list');
  try {
    const data = await fetchJSON('/api/ref-articles');
    imitateState.articles = data.articles || [];
    renderRefArticleList();
  } catch (err) {
    if (el) el.innerHTML = '<div class="empty-state" style="color:#f87171">加载失败：' + escHtml(err.message) + '</div>';
  }
}

function renderRefArticleList() {
  const el   = document.getElementById('ref-article-list');
  const list = imitateState.articles;
  if (!el) return;
  if (!list.length) {
    el.innerHTML = '<div class="empty-state">暂无参考文章<br><span style="font-size:0.85rem;opacity:.6">点击上方「添加文章」，将参考文章粘贴进来</span></div>';
    updateRefSelectedBadge();
    return;
  }
  el.innerHTML = list.map(a => {
    const checked = imitateState.selectedIds.includes(a.id);
    return `
      <div class="ref-article-item ${checked ? 'selected' : ''}" id="ref-item-${a.id}" onclick="toggleRefSelect('${a.id}')">
        <input type="checkbox" class="ref-checkbox" ${checked ? 'checked' : ''} onclick="event.stopPropagation(); toggleRefSelect('${a.id}')" />
        <div class="ref-article-body">
          <div class="ref-article-title">${escHtml(a.title)}</div>
          <div class="ref-article-meta">${a.wordCount || 0} 字 · ${(a.createdAt || '').substring(0, 10)}</div>
          <div class="ref-article-preview">${escHtml(a.preview || '')}</div>
        </div>
        <button class="btn-icon-del" onclick="deleteRefArticle(event, '${a.id}')">
          <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        </button>
      </div>
    `;
  }).join('');
  updateRefSelectedBadge();
}

function toggleRefSelect(id) {
  const idx = imitateState.selectedIds.indexOf(id);
  if (idx === -1) {
    if (imitateState.selectedIds.length >= 5) { showToast('最多勾选 5 篇参考文章', 'error'); return; }
    imitateState.selectedIds.push(id);
  } else {
    imitateState.selectedIds.splice(idx, 1);
  }
  renderRefArticleList();
}

function updateRefSelectedBadge() {
  const badge = document.getElementById('ref-selected-badge');
  const n = imitateState.selectedIds.length;
  if (badge) badge.textContent = n ? '已选 ' + n + ' 篇' : '';
}

async function deleteRefArticle(e, id) {
  e.stopPropagation();
  try {
    await fetchJSON('/api/ref-articles/' + id, { method: 'DELETE' });
    imitateState.selectedIds = imitateState.selectedIds.filter(i => i !== id);
    await loadRefArticles();
    showToast('已删除');
  } catch (err) {
    showToast('删除失败：' + err.message, 'error');
  }
}

// ── 风格选择 ─────────────────────────────────────────
// v3.0.1：仿写页面改用下拉风格档案选择（与生成文章一致），废弃旧 chip
// 保留旧变量防止遗留调用报错
let _imitateStyleChip = 'yushtang';

/**
 * 初始化仿写页面风格档案下拉：动态加载自定义档案
 */
async function initImitateStyleSwitcher() {
  const sel = document.getElementById('imitate-style-switcher');
  if (!sel) return;
  try {
    const data = await fetchJSON('/api/profiles');
    const profiles = data.profiles || [];
    const insertBefore = sel.querySelector('option[value="ref"]');
    // 清除旧自定义选项（防止重复）
    sel.querySelectorAll('option.imitate-custom-opt').forEach(o => o.remove());
    const customs = profiles.filter(p => p.id !== 'yushtang' && p.id !== 'zaiwang');
    customs.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.className = 'imitate-custom-opt';
      opt.textContent = (p.icon ? p.icon + ' ' : '') + p.name;
      if (insertBefore) sel.insertBefore(opt, insertBefore);
      else sel.appendChild(opt);
    });
  } catch (e) {
    console.warn('[ImitateStyleSwitcher] 加载档案失败:', e.message);
  }
  onImitateStyleSwitcherChange();
}

function onImitateStyleSwitcherChange() {
  const sel  = document.getElementById('imitate-style-switcher');
  const hint = document.getElementById('imitate-style-switcher-hint');
  if (!sel || !hint) return;
  const val = sel.value;
  if (val === 'none') {
    hint.textContent = 'AI 自由发挥，无风格约束';
  } else if (val === 'ref') {
    hint.textContent = '完全学习参考文章的写作风格';
  } else {
    const txt = sel.options[sel.selectedIndex]?.text || val;
    hint.textContent = `已选：${txt}，Prompt 将注入该档案`;
  }
  // 同步旧变量（兼容遗留代码）
  _imitateStyleChip = val;
}

function selectImitateProfile(profileId) {
  imitateState.selectedProfile = profileId;
  document.querySelectorAll('#imitate-style-selector .style-option').forEach(el => {
    el.classList.toggle('active', el.dataset.profile === profileId);
  });
}

// v2.9.7：深度研究 toggle
function toggleDeepResearch(checkbox) {
  const knob = document.getElementById('imitate-deep-research-knob');
  const label = document.getElementById('imitate-deep-research-label');
  if (knob) knob.classList.toggle('on', checkbox.checked);
  if (label) label.classList.toggle('active', checkbox.checked);
}

async function loadCustomProfileOptions() {
  const container = document.getElementById('custom-profile-options');
  if (!container) return;
  try {
    const data = await fetchJSON('/api/profiles');
    const customs = (data.profiles || []).filter(p =>
      p.id !== 'yushtang' && p.id !== 'zaiwang'
    );
    container.innerHTML = customs.map(p => `
      <div class="style-option" data-profile="${escHtml(p.id)}" onclick="selectImitateProfile('${escHtml(p.id)}')">
        <span class="style-icon">${escHtml(p.icon || '📝')}</span>
        <div class="style-info-text">
          <div class="style-name">${escHtml(p.name)}</div>
          <div class="style-desc">${p.sample_count ? p.sample_count + ' 篇样本' : '未分析'}</div>
        </div>
      </div>
    `).join('');
  } catch(e) {}
}

// ── 仿写深度选择 ─────────────────────────────────────
function selectImitateMode(mode) {
  imitateState.imitateMode = mode;
  const quickEl = document.getElementById('imitate-mode-quick');
  const deepEl  = document.getElementById('imitate-mode-deep');
  if (quickEl) quickEl.classList.toggle('active', mode === 'quick');
  if (deepEl)  deepEl.classList.toggle('active',  mode === 'deep');
}

// ── 开始仿写 ─────────────────────────────────────────
async function startImitate() {
  const topic = (document.getElementById('imitate-topic') || {}).value.trim();
  const note  = (document.getElementById('imitate-note')  || {}).value.trim();
  if (!topic)                          { showToast('请填写想写的主题', 'error'); return; }
  if (!imitateState.selectedIds.length){ showToast('请至少勾选 1 篇参考文章', 'error'); return; }

  // v3.0.1：从仿写风格档案下拉读取风格（已废弃旧 chip）
  const imitateStyleSel = document.getElementById('imitate-style-switcher');
  const styleChip    = imitateStyleSel ? imitateStyleSel.value : (_imitateStyleChip || 'yushtang');
  const deepResearch = document.getElementById('imitate-deep-research')?.checked || false;

  const useTavily    = deepResearch || (document.getElementById('imitate-tavily-enabled') ? document.getElementById('imitate-tavily-enabled').checked : false);
  const imitateMode  = imitateState.imitateMode || 'quick';
  const profileId    = imitateState.selectedProfile || 'yushtang';

  const btn       = document.getElementById('btn-imitate');
  const progArea  = document.getElementById('imitate-progress-area');
  const progMsg   = document.getElementById('imitate-progress-msg');
  const resultEl  = document.getElementById('imitate-result');
  const configPan = document.getElementById('imitate-config-panel');

  setLoading(btn, true, 'AI 仿写中...');
  if (progArea)  progArea.style.display = 'block';
  if (resultEl)  resultEl.style.display = 'none';
  [1,2,3,4].forEach(n => setImiStep(n, ''));
  setImiStep(1, 'active');

  try {
    const resp = await fetch('/api/imitate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        refIds: imitateState.selectedIds,
        topic, extraNote: note,
        imitateMode, useTavily, profileId,
        styleChip,   // v2.9.7：风格选择
      }),
    });
    if (!resp.ok) throw new Error('服务器错误 ' + resp.status);
    if (!resp.body) throw new Error('浏览器不支持流式读取');

    const reader  = resp.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const msg = JSON.parse(line.slice(5).trim());
        if (msg.type === 'progress') {
          if (progMsg) progMsg.textContent = msg.msg;
          if (msg.step === 1) setImiStep(1, 'active');
          if (msg.step === 2) { setImiStep(1, 'done'); setImiStep(2, 'active'); }
          if (msg.step === 3) { setImiStep(2, 'done'); setImiStep(3, 'active'); }
          if (msg.step === 4) { setImiStep(3, 'done'); setImiStep(4, 'active'); }
        }
        if (msg.__done) {
          if (msg.error) {
            showToast('仿写失败：' + msg.error, 'error');
            if (progMsg) progMsg.textContent = '⚠️ ' + msg.error;
          } else {
            setImiStep(4, 'done');
            renderImitateResult(msg);
            if (progMsg) progMsg.textContent = '✓ 仿写完成！';
            loadStatus();
          }
        }
      }
    }
  } catch (err) {
    showToast('仿写失败：' + err.message, 'error');
    if (progMsg) progMsg.textContent = '⚠️ ' + err.message;
  } finally {
    setLoading(btn, false);
  }
}

function setImiStep(num, st) {
  const el = document.getElementById('istep-' + num);
  if (!el) return;
  el.className = 'write-step' + (st ? ' ' + st : '');
  const icon = el.querySelector('.wstep-icon');
  if (!icon) return;
  icon.textContent = st === 'active' ? '⚙️' : st === 'done' ? '✅' : '⏳';
}

function renderImitateResult(data) {
  // ══════════════════════════════════════════════════════
  // 三不准第①②条 — 双重 Target Locking 守卫（imitate 版）
  // ══════════════════════════════════════════════════════

  // 守卫一：state 检查
  if (state.currentPage !== 'imitate') {
    console.warn('[renderImitateResult] ⛔ 守卫一拦截 — 当前页：' + state.currentPage + '，不是 imitate，渲染取消');
    return;
  }
  // 守卫二：DOM 归属检查
  const pageImitateEl = document.getElementById('page-imitate');
  if (!pageImitateEl || !pageImitateEl.classList.contains('active')) {
    console.warn('[renderImitateResult] ⛔ 守卫二拦截 — #page-imitate 不是 active，渲染取消');
    return;
  }
  // 守卫三：Scoped Mount 检查
  const resultEl = document.getElementById('imitate-result');
  if (!resultEl || !pageImitateEl.contains(resultEl)) {
    console.error('[renderImitateResult] ⛔ 守卫三拦截 — imitate-result 不在 page-imitate 内，DOM 结构异常');
    return;
  }

  const titleEl = document.getElementById('imitate-result-title');
  if (titleEl) titleEl.textContent = data.title || '仿写结果';
  // Scoped Mount：只允许写入 #page-imitate 内的 #imitate-result
  resultEl.style.display = 'block';

  const wcEl = document.getElementById('imitate-wordcount');
  if (wcEl) wcEl.textContent = '约 ' + (data.wordCount || 0) + ' 字';

  const tagsEl = document.getElementById('imitate-tags');
  if (tagsEl) tagsEl.innerHTML = (data.tags || []).map(t => '<span class="tag-chip">' + escHtml(t) + '</span>').join('');

  const profileUsedEl = document.getElementById('imitate-profile-used');
  if (profileUsedEl) profileUsedEl.textContent = data.profileName ? '风格：' + data.profileName : '';

  const refEl = document.getElementById('imitate-ref-source');
  if (refEl) {
    if (data.refTitles && data.refTitles.length) {
      refEl.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg> 参考自：' +
        data.refTitles.map(t => '<span class="ref-badge">' + escHtml(t) + '</span>').join('');
      refEl.style.display = 'flex';
    } else {
      refEl.style.display = 'none';
    }
  }

  const summaryEl = document.getElementById('imitate-summary');
  if (summaryEl) {
    summaryEl.style.display = data.summary ? 'block' : 'none';
    if (data.summary) summaryEl.textContent = data.summary;
  }

  const contentEl = document.getElementById('imitate-content');
  if (contentEl) {
    let html = typeof marked !== 'undefined' ? marked.parse(data.content || '') : (data.content || '').replace(/\n/g, '<br>');
    html = formatSectionHeadings(html);
    contentEl.innerHTML = html;

    // ── 异步 FLUX 配图（仅 siliconflow provider 时生效）────
    genImagesAsync(contentEl, data.title || '仿写文章');
  }

  // v2.9.3: 禁止整页跳转，结果直接在当前位置展示
}

function copyImitateResult() {
  const content = document.getElementById('imitate-content').innerText;
  navigator.clipboard.writeText(content)
    .then(() => showToast('正文已复制到剪贴板'))
    .catch(() => showToast('复制失败，请手动选择复制', 'error'));
}

function resetImitate() {
  const ri = document.getElementById('imitate-result');
  const pa = document.getElementById('imitate-progress-area');
  const pm = document.getElementById('imitate-progress-msg');
  if (ri) ri.style.display = 'none';
  if (pa) pa.style.display = 'none';
  [1, 2, 3, 4].forEach(n => setImiStep(n, ''));
  if (pm) pm.textContent = '';
  const it = document.getElementById('imitate-topic');
  if (it) it.focus();
}






// ════════════════════════════════════════════════════════
// 全网热点模块
// ════════════════════════════════════════════════════════
let globalHotTimeRange = 'realtime'; // 'realtime' | '24h' | '7d'

function switchHotTab(tab) {
  const localContent  = document.getElementById('hot-content-local');
  const globalContent = document.getElementById('hot-content-global');
  const localTab      = document.getElementById('hot-tab-local');
  const globalTab     = document.getElementById('hot-tab-global');
  if (tab === 'local') {
    if (localContent) localContent.style.display = 'block';
    if (globalContent) globalContent.style.display = 'none';
    if (localTab) localTab.classList.add('active');
    if (globalTab) globalTab.classList.remove('active');
  } else {
    if (localContent) localContent.style.display = 'none';
    if (globalContent) globalContent.style.display = 'block';
    if (localTab) localTab.classList.remove('active');
    if (globalTab) globalTab.classList.add('active');
    // v2.9.6：切换到全网热点时，如果列表为空则自动加载今日热点
    const listEl = document.getElementById('global-hot-list');
    if (listEl && !listEl.innerHTML.trim()) {
      loadGlobalHot();
    }
  }
}

function switchTimeRange(range) {
  globalHotTimeRange = range;
  ['realtime', '24h', '7d'].forEach(r => {
    const btn = document.getElementById('trt-' + r);
    if (btn) btn.classList.toggle('active', r === range);
  });
}

async function loadGlobalHot() {
  const query      = document.getElementById('global-hot-query').value.trim();
  const btn        = document.getElementById('btn-global-search');
  const listEl     = document.getElementById('global-hot-list');
  const progressEl = document.getElementById('global-hot-progress');
  const msgEl      = document.getElementById('global-hot-msg');
  const sourceBar  = document.getElementById('global-source-bar');

  const timeRangeLabel = globalHotTimeRange === 'realtime' ? '实时' : globalHotTimeRange === '24h' ? '24小时内' : '7天内';
  setLoading(btn, true, '搜索中...');
  if (progressEl) progressEl.style.display = 'block';
  if (msgEl) msgEl.textContent = query ? `正在搜索「${query}」(${timeRangeLabel})...` : `正在获取${timeRangeLabel}全网热点...`;
  if (listEl) listEl.innerHTML = '';
  if (sourceBar) {
    sourceBar.style.display = 'flex';
    const dot = document.getElementById('global-src-dot');
    const cnt = document.getElementById('global-src-count');
    if (dot) dot.className = 'source-dot ok';
    if (cnt) cnt.textContent = '搜索中...';
  }

  try {
    // v2.9.6：请求时带 max_results=10，确保至少10条
    const data     = await fetchJSON('/api/global-hot', { method: 'POST', body: { query, timeRange: globalHotTimeRange, max_results: 10 } });
    const articles = data.articles || [];
    if (progressEl) progressEl.style.display = 'none';
    if (!articles.length) {
      if (listEl) listEl.innerHTML = '<div class="empty-state">未找到相关内容</div>';
      if (msgEl) msgEl.textContent = '⚠️ 未找到相关内容';
      return;
    }
    if (listEl) {
      listEl.innerHTML = articles.map((a, i) => {
        // v2.9.6：热度排名徽章（前3名金银铜配色）
        const rankColors  = ['#FF4D00', '#FF8C00', '#C0A030', '#666', '#666'];
        const rankBgColors = ['#FFF3EE', '#FFF8EE', '#FAFAEE', '#F5F5F5', '#F5F5F5'];
        const rankBg   = rankBgColors[Math.min(i, 4)];
        const rankColor = rankColors[Math.min(i, 4)];
        const rankLabel = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}`;
        // 热度值（模拟热度，有真实数据时使用）
        const hotScore = a.score ? Math.round(a.score * 100) : Math.max(10, 100 - i * 8);
        const hotBar   = Math.max(8, Math.round((hotScore / 100) * 80));
        const urlHtml  = a.url ? `<a href="${escHtml(a.url)}" target="_blank" style="color:var(--accent);font-size:12px;margin-left:8px;">查看原文 ↗</a>` : '';
        return `
        <div class="topic-card" style="cursor:pointer;background:${i < 3 ? rankBg : ''}" onclick="selectGlobalHotTopic('${escHtml(a.title)}')">
          <div class="topic-num" style="min-width:36px;font-size:${i < 3 ? '22px' : '16px'};color:${rankColor};font-weight:700;text-align:center;">${rankLabel}</div>
          <div class="topic-body" style="flex:1;min-width:0;">
            <div class="topic-title" style="font-weight:${i < 3 ? '700' : '500'};font-size:${i < 3 ? '15px' : '14px'}">${escHtml(a.title)}</div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:5px;">
              <span class="topic-source">${escHtml(a.source || 'Tavily')}</span>
              <!-- 热度条 -->
              <div style="flex:1;max-width:80px;height:4px;background:#eee;border-radius:2px;overflow:hidden">
                <div style="width:${hotBar}%;height:100%;background:${rankColor};border-radius:2px;"></div>
              </div>
              <span style="font-size:11px;color:${rankColor};font-weight:600;">热度 ${hotScore}</span>
              ${urlHtml}
            </div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();selectGlobalHotTopic('${escHtml(a.title)}')">用此写文章</button>
        </div>`;
      }).join('');
    }
    const cntEl = document.getElementById('global-src-count');
    if (cntEl) cntEl.textContent = articles.length + ' 条';
    if (msgEl) msgEl.textContent = `✓ 找到 ${articles.length} 条结果（${timeRangeLabel}，按热度排序）`;
  } catch (err) {
    if (progressEl) progressEl.style.display = 'none';
    if (listEl) listEl.innerHTML = '<div class="empty-state" style="color:var(--danger)">搜索失败：' + escHtml(err.message) + '</div>';
    if (msgEl) msgEl.textContent = '⚠️ 搜索失败：' + err.message;
  } finally {
    setLoading(btn, false);
  }
}

function selectGlobalHotTopic(title) {
  const kw = document.getElementById('kw-input');
  if (kw) kw.value = title;
  navigate('write');
  showToast('已跳转到生成文章，点击「搜索新闻」继续');
}

// ════════════════════════════════════════════════════════
// 自定义消息源管理
// ════════════════════════════════════════════════════════
const CUSTOM_SOURCES_KEY = 'wx_writer_custom_sources';

function loadCustomSources() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_SOURCES_KEY) || '[]');
  } catch(e) { return []; }
}

function saveCustomSources(sources) {
  localStorage.setItem(CUSTOM_SOURCES_KEY, JSON.stringify(sources));
}

function renderCustomSourceChips() {
  const sources = loadCustomSources();
  const container = document.getElementById('custom-source-chips');
  if (!container) return;
  container.innerHTML = sources.map((s, i) => `
    <div class="source-chip" id="src-chip-custom-${i}">
      <span class="source-chip-dot" id="src-dot-custom-${i}"></span>
      <span class="source-chip-name" title="${escHtml(s.url)}">${escHtml(s.name.length > 8 ? s.name.substring(0, 8) + '…' : s.name)}</span>
      <button class="source-chip-del" onclick="deleteCustomSource(${i})" title="删除此消息源">✕</button>
    </div>
  `).join('');
}

function showAddSourceModal() {
  const modal = document.getElementById('add-source-modal');
  if (modal) {
    modal.classList.add('open');
    const nameEl = document.getElementById('new-source-name');
    const urlEl  = document.getElementById('new-source-url');
    const selEl  = document.getElementById('new-source-selector');
    if (nameEl) nameEl.value = '';
    if (urlEl)  urlEl.value  = '';
    if (selEl)  selEl.value  = '';
  }
}

function closeAddSourceModal(event) {
  if (event.target === event.currentTarget) {
    event.currentTarget.classList.remove('open');
  }
}

function addCustomSource() {
  const name = (document.getElementById('new-source-name')?.value || '').trim();
  const url  = (document.getElementById('new-source-url')?.value  || '').trim();
  const sel  = (document.getElementById('new-source-selector')?.value || '').trim();
  if (!name) { showToast('请输入消息源名称', 'error'); return; }
  if (!url)  { showToast('请输入网站地址', 'error'); return; }
  if (!url.startsWith('http')) { showToast('网站地址需以 http:// 或 https:// 开头', 'error'); return; }

  const sources = loadCustomSources();
  if (sources.some(s => s.url === url)) { showToast('该消息源已存在', 'error'); return; }
  sources.push({ name, url, selector: sel });
  saveCustomSources(sources);
  renderCustomSourceChips();
  // 关闭弹窗并清空输入
  const modal = document.getElementById('add-source-modal');
  if (modal) modal.classList.remove('open');
  ['new-source-name','new-source-url','new-source-selector'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  showToast(`已添加消息源「${name}」，点击刷新即生效`);
}

function deleteCustomSource(index) {
  const sources = loadCustomSources();
  const removed = sources.splice(index, 1);
  saveCustomSources(sources);
  renderCustomSourceChips();
  if (removed.length) showToast(`已删除消息源「${removed[0].name}」`);
}

// ════════════════════════════════════════════════════════
// 微信排版预览  v2.9.2 — 对标 148085 顶级美学
// ════════════════════════════════════════════════════════

/**
 * 风格模板系统 —— 支持多种视觉风格
 *
 * 当前选中风格：default（默认风格）
 * 切换方法：setWxStyle('styleName')
 */

// ════════════════════════════════════════════════════════
// 风格模板定义
// ════════════════════════════════════════════════════════
const WX_STYLES = {
  // ── 默认风格：专业蓝绿（148085）──────
  'default': {
    name: '专业蓝绿',
    emoji: '💎',
    // ── 正文
    fontSizePx: 18,
    lineHeight: 1.8,
    letterSpacing: '0.5px',
    paraMargin: '24px',
    bodyColor: '#2c2c2c',
    // ── 品牌色
    brand: '#148085',
    brandLight: '#4db4b9',
    brandDark: '#0f5c63',
    brandContrast: '#FFFFFF',
    // ── H2 序号
    indexFontSize: '56px',
    indexWeight: '800',
    indexColor: '#148085',
    // ── H2 标题
    headingFontSize: '21px',
    headingPadding: '6px 14px',
    headingGap: '-12px',
    headingMarginLeft: '12px',
    headingBg: 'linear-gradient(135deg,#148085 0%,#0f5c63 100%)',
    headingShadow: '0 2px 8px rgba(20,128,133,0.25)',
    // ── 其他元素
    h1Color: '#1a1a1a',
    h1Size: '28px',
    linkColor: '#07C160',
    blockquoteBg: '#f0f7f8',
    blockquoteBorder: '#148085',
    blockquoteRadius: '8px',
    blockquoteShadow: '0 2px 6px rgba(20,128,133,0.06)',
    codeBg: '#f6f8fa',
    codeColor: '#d63384',
    codeRadius: '4px',
    // ── 图片
    imgRadius: '12px',
    imgShadow: '0 4px 16px rgba(0,0,0,0.08)',
    imgMargin: '24px 0',
    // ── 配图占位
    imgSlotBg: 'linear-gradient(135deg,#f0f8f8 0%,#e0f0f0 100%)',
    imgSlotRadius: '12px',
    imgSlotMargin: '20px 0',
    imgSlotBorder: '2px dashed #b8d8d8',
    imgSlotHeight: '140px',
  },

  // ── 温暖橙黄（活力感）──────
  'warm': {
    name: '温暖橙黄',
    emoji: '🌅',
    // ── 正文
    fontSizePx: 18,
    lineHeight: 1.75,
    letterSpacing: '0.5px',
    paraMargin: '22px',
    bodyColor: '#333333',
    // ── 品牌色
    brand: '#ff9800',
    brandLight: '#ffb74d',
    brandDark: '#e65100',
    brandContrast: '#FFFFFF',
    // ── H2 序号
    indexFontSize: '52px',
    indexWeight: '700',
    indexColor: '#ff9800',
    // ── H2 标题
    headingFontSize: '20px',
    headingPadding: '5px 12px',
    headingGap: '-10px',
    headingMarginLeft: '10px',
    headingBg: '#ff9800',
    headingShadow: '0 2px 6px rgba(255,152,0,0.2)',
    // ── 其他元素
    h1Color: '#212121',
    h1Size: '26px',
    linkColor: '#ff6f00',
    blockquoteBg: '#fff8e1',
    blockquoteBorder: '#ff9800',
    blockquoteRadius: '6px',
    blockquoteShadow: 'none',
    codeBg: '#fff3e0',
    codeColor: '#e65100',
    codeRadius: '4px',
    // ── 图片
    imgRadius: '8px',
    imgShadow: '0 3px 10px rgba(0,0,0,0.1)',
    imgMargin: '20px 0',
    // ── 配图占位
    imgSlotBg: 'linear-gradient(135deg,#fff8e1 0%,#ffecb3 100%)',
    imgSlotRadius: '8px',
    imgSlotMargin: '16px 0',
    imgSlotBorder: '2px dashed #ffcc80',
    imgSlotHeight: '130px',
  },

  // ── 科技蓝灰（极简冷淡）──────
  'tech': {
    name: '科技蓝灰',
    emoji: '🔮',
    // ── 正文
    fontSizePx: 17,
    lineHeight: 1.7,
    letterSpacing: '0.3px',
    paraMargin: '20px',
    bodyColor: '#1f2937',
    // ── 品牌色
    brand: '#3b82f6',
    brandLight: '#60a5fa',
    brandDark: '#1e40af',
    brandContrast: '#FFFFFF',
    // ── H2 序号
    indexFontSize: '48px',
    indexWeight: '700',
    indexColor: '#3b82f6',
    // ── H2 标题
    headingFontSize: '19px',
    headingPadding: '4px 10px',
    headingGap: '-8px',
    headingMarginLeft: '8px',
    headingBg: '#3b82f6',
    headingShadow: '0 1px 4px rgba(59,130,246,0.15)',
    // ── 其他元素
    h1Color: '#111827',
    h1Size: '24px',
    linkColor: '#3b82f6',
    blockquoteBg: '#f8fafc',
    blockquoteBorder: '#cbd5e1',
    blockquoteRadius: '4px',
    blockquoteShadow: 'none',
    codeBg: '#f1f5f9',
    codeColor: '#0f172a',
    codeRadius: '2px',
    // ── 图片
    imgRadius: '4px',
    imgShadow: '0 2px 8px rgba(0,0,0,0.06)',
    imgMargin: '18px 0',
    // ── 配图占位
    imgSlotBg: 'linear-gradient(135deg,#f8fafc 0%,#e2e8f0 100%)',
    imgSlotRadius: '4px',
    imgSlotMargin: '14px 0',
    imgSlotBorder: '1px dashed #cbd5e1',
    imgSlotHeight: '120px',
  },

  // ── 自然绿意（清新文艺）──────
  'nature': {
    name: '自然绿意',
    emoji: '🍃',
    // ── 正文
    fontSizePx: 18,
    lineHeight: 1.85,
    letterSpacing: '0.8px',
    paraMargin: '26px',
    bodyColor: '#2d3748',
    // ── 品牌色
    brand: '#10b981',
    brandLight: '#6ee7b7',
    brandDark: '#047857',
    brandContrast: '#FFFFFF',
    // ── H2 序号
    indexFontSize: '54px',
    indexWeight: '700',
    indexColor: '#10b981',
    // ── H2 标题
    headingFontSize: '20px',
    headingPadding: '5px 12px',
    headingGap: '-10px',
    headingMarginLeft: '10px',
    headingBg: 'linear-gradient(135deg,#10b981 0%,#047857 100%)',
    headingShadow: '0 3px 10px rgba(16,185,129,0.2)',
    // ── 其他元素
    h1Color: '#1a202c',
    h1Size: '27px',
    linkColor: '#059669',
    blockquoteBg: '#ecfdf5',
    blockquoteBorder: '#10b981',
    blockquoteRadius: '10px',
    blockquoteShadow: '0 2px 8px rgba(16,185,129,0.08)',
    codeBg: '#f0fdf4',
    codeColor: '#065f46',
    codeRadius: '6px',
    // ── 图片
    imgRadius: '10px',
    imgShadow: '0 4px 12px rgba(0,0,0,0.08)',
    imgMargin: '22px 0',
    // ── 配图占位
    imgSlotBg: 'linear-gradient(135deg,#ecfdf5 0%,#d1fae5 100%)',
    imgSlotRadius: '10px',
    imgSlotMargin: '18px 0',
    imgSlotBorder: '2px dashed #6ee7b7',
    imgSlotHeight: '135px',
  },

  // ── 极简黑白（杂志感）──────
  'minimal': {
    name: '极简黑白',
    emoji: '⚪',
    // ── 正文
    fontSizePx: 17,
    lineHeight: 1.75,
    letterSpacing: '0.3px',
    paraMargin: '18px',
    bodyColor: '#000000',
    // ── 品牌色
    brand: '#000000',
    brandLight: '#4b5563',
    brandDark: '#000000',
    brandContrast: '#FFFFFF',
    // ── H2 序号
    indexFontSize: '42px',
    indexWeight: '800',
    indexColor: '#000000',
    // ── H2 标题
    headingFontSize: '18px',
    headingPadding: '3px 8px',
    headingGap: '-6px',
    headingMarginLeft: '6px',
    headingBg: '#000000',
    headingShadow: 'none',
    // ── 其他元素
    h1Color: '#000000',
    h1Size: '24px',
    linkColor: '#000000',
    blockquoteBg: '#f5f5f5',
    blockquoteBorder: '#e5e5e5',
    blockquoteRadius: '2px',
    blockquoteShadow: 'none',
    codeBg: '#f5f5f5',
    codeColor: '#000000',
    codeRadius: '2px',
    // ── 图片
    imgRadius: '2px',
    imgShadow: 'none',
    imgMargin: '16px 0',
    // ── 配图占位
    imgSlotBg: '#f5f5f5',
    imgSlotRadius: '2px',
    imgSlotMargin: '12px 0',
    imgSlotBorder: '1px dashed #d4d4d4',
    imgSlotHeight: '110px',
  },
};

// ── 当前选中的风格 ───────────────────────────────────────
let currentWxStyle = 'default';

/**
 * 切换微信预览风格
 * @param {string} styleName - 风格名称（default/warm/tech/nature/minimal）
 */
function setWxStyle(styleName) {
  if (!WX_STYLES[styleName]) {
    console.warn('[setWxStyle] 未知风格:', styleName);
    return;
  }

  currentWxStyle = styleName;
  const titleEl = document.getElementById('wx-preview-title');
  const bodyEl = document.getElementById('wx-preview-body');

  if (titleEl && bodyEl && titleEl.textContent && bodyEl.innerHTML) {
    // 重新渲染预览（使用新风格）
    // 从 localStorage 恢复原始 Markdown
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      const draft = JSON.parse(raw);
      refreshPreview(draft.title || titleEl.textContent, draft.content || '');
    }
  }

  // 更新选择器 UI
  renderStyleSelector();

  console.log('[setWxStyle] 切换到风格:', WX_STYLES[styleName].name);
}

/**
 * 渲染风格选择器（在微信预览区顶部）
 */
function renderStyleSelector() {
  const selectorEl = document.getElementById('wx-style-selector');
  if (!selectorEl) return;

  const options = Object.keys(WX_STYLES).map(key => {
    const style = WX_STYLES[key];
    const isActive = key === currentWxStyle;
    return `
      <button
        class="style-chip ${isActive ? 'active' : ''}"
        onclick="setWxStyle('${key}')"
        title="${style.name}"
      >
        <span>${style.emoji}</span>
        <span>${style.name}</span>
      </button>
    `;
  }).join('');

  selectorEl.innerHTML = options;
}

/**
 * 排版 Token —— 从当前风格获取
 * ⚠️ 不要直接修改此对象，通过 WX_STYLES 预定义风格切换
 */
function getWxTypography() {
  return WX_STYLES[currentWxStyle] || WX_STYLES['default'];
}

/**
 * 将 marked 渲染的 HTML 注入 Inline CSS（微信公众号兼容）
 *
 * 设计规范（v2.9.3）：
 * - 章节序号：50px 品牌色大数字，压倒性视觉，相对定位实现错位叠放
 * - 章节标题行：#148085 背景色块，白色文字，向上 position 叠压序号底部
 * - 正文：18px / 1.75行高 / 字间距1px / justify / 全 Inline CSS 锁死
 * - H2 下方自动插入 16:9 配图占位槽
 * - 所有样式均为 Inline CSS，确保微信后台 100% 还原
 *
 * @param {string} html  marked.parse() 输出的原始 HTML
 * @returns {string}     注入了 Inline Style 的 HTML（微信兼容）
 */
function injectWxInlineStyles(html) {
  const t = getWxTypography(); // 动态获取当前风格

  // ── 基础正文样式（所有段落共用，全 Inline CSS 锁死）────
  const baseStyle = [
    `font-size:${t.fontSizePx}px`,
    `line-height:${t.lineHeight}`,
    `color:${t.bodyColor}`,
    `font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif`,
    `letter-spacing:${t.letterSpacing}`,
    `text-align:justify`,
    `margin-top:${t.paraMargin}`,
    `margin-bottom:0`,
    `word-break:break-word`,
  ].join(';') + ';';

  // ── 配图占位槽 HTML（H2 下方自动插入）────────────────
  let imgSlotIdx = 0;
  const makeImgSlot = (sectionTitle) => {
    imgSlotIdx++;
    // v3.0.4 美学优化：更精致的渐变、加粗边框、增大圆角
    return `<div class="img-placeholder" style="width:100%;height:140px;background:${t.imgSlotBg};display:flex;align-items:center;justify-content:center;border-radius:${t.imgSlotRadius};margin:${t.imgSlotMargin};color:${t.brand};font-size:13px;border:${t.imgSlotBorder};opacity:0.85;box-shadow:0 2px 8px rgba(20,128,133,0.06);">` +
      `<span style="background:#fff;padding:8px 16px;border-radius:20px;box-shadow:0 2px 6px rgba(20,128,133,0.1);">📷 配图区域 · ${escHtml(sectionTitle)}</span></div>`;
  };

  // ── H2 章节序号计数器 ──────────────────────────────────
  let sectionIdx = 0;

  // ── 第一步：处理 H2 — 错位叠放效果 ────────────────────
  // 原理：序号大字 position:relative，标题色块 margin-top 负值向上叠压，
  //       形成序号底部与色块顶部的物理重合感。全 Inline CSS，微信兼容。
  let result = html.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (match, content) => {
    sectionIdx++;
    const num = String(sectionIdx).padStart(2, '0');
    // v2.9.6：去掉 AI 可能带入的数字前缀（如 "03 标题名" → "标题名"），避免重复显示
    const cleanContent = content.replace(/^\s*\d{1,2}[\s\.\:：\-]+\s*/, '').trim();
    return [
      // 外层容器：margin-top 给整体章节留出上空间
      `<div style="margin-top:48px;margin-bottom:0;padding-bottom:8px;">`,
      // ① 章节序号：56px 品牌色大数字（v3.0.4 增大至 56px）
      `<p style="font-size:${t.indexFontSize} !important;color:${t.indexColor} !important;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif !important;font-weight:${t.indexWeight} !important;line-height:1.0 !important;margin:0 !important;padding:0 !important;">${num}</p>`,
      // ② 标题色块：渐变背景 + 圆角 + 增大 padding（v3.0.4 美学优化）
      `<p style="margin:0 !important;padding:0 !important;margin-top:${t.headingGap} !important;">`,
      `<span style="display:inline-block !important;background:linear-gradient(135deg,${t.brand} 0%,${t.brandDark} 100%) !important;padding:${t.headingPadding} !important;color:${t.brandContrast} !important;font-size:${t.headingFontSize} !important;font-weight:700 !important;margin-left:${t.headingMarginLeft} !important;border-radius:6px !important;line-height:1.5 !important;letter-spacing:0.5px;box-shadow:0 2px 8px rgba(20,128,133,0.25);">${cleanContent}</span>`,
      `</p>`,
      `</div>`,
      // ③ 配图占位槽（v3.0.4 美学优化）
      makeImgSlot(cleanContent),
    ].join('');
  });

  // ── 第二步：处理其余元素，注入 Inline CSS ──────────────
  return result
    // H1（v3.0.4 增大字号至 28px）
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (m, c) =>
      `<p style="font-size:${t.h1Size} !important;font-weight:700;color:${t.h1Color};margin:1.4em 0 0.7em;line-height:1.4;letter-spacing:0.5px;">${c}</p>`)
    // H3（v3.0.4 优化左边线粗细和圆角）
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (m, c) =>
      `<p style="font-size:19px;font-weight:600;color:${t.brand};margin:1.0em 0 0.5em;line-height:1.4;border-left:4px solid ${t.brand};padding-left:10px;border-radius:0 4px 4px 0;">${c}</p>`)
    // H4
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (m, c) =>
      `<p style="font-size:18px;font-weight:600;color:#444;margin:0.6em 0 0.3em;">${c}</p>`)
    // 段落
    .replace(/<p>/g, `<p style="${baseStyle}">`)
    // 无序列表
    .replace(/<ul>/g, `<ul style="${baseStyle}padding-left:1.8em;margin:0.8em 0 1.2em;">`)
    // 有序列表
    .replace(/<ol>/g, `<ol style="${baseStyle}padding-left:1.8em;margin:0.8em 0 1.2em;">`)
    // 列表项
    .replace(/<li>/g, `<li style="margin-bottom:0.5em;line-height:1.8;">`)
    // blockquote（v3.0.4 美学优化：圆角、柔和背景）
    .replace(/<blockquote>/g, `<blockquote style="border-left:4px solid ${t.blockquoteBorder};background:${t.blockquoteBg};margin:1.2em 0;padding:16px 20px;border-radius:${t.blockquoteRadius};box-shadow:0 2px 6px rgba(20,128,133,0.06);">`)
    // 行内代码（v3.0.4 美学优化：圆角）
    .replace(/<code>/g, `<code style="background:${t.codeBg};color:${t.codeColor};padding:3px 7px;border-radius:${t.codeRadius};font-size:0.9em;font-family:'SF Mono','Consolas',monospace;">`)
    // 代码块（v3.0.4 美学优化：圆角增大）
    .replace(/<pre>/g, `<pre style="background:${t.codeBg};padding:16px 20px;border-radius:8px;overflow-x:auto;margin:1.2em 0;font-size:13px;line-height:1.7;box-shadow:0 2px 6px rgba(0,0,0,0.04);">`)
    // 强调（粗体，品牌色提亮）
    .replace(/<strong>/g, `<strong style="color:${t.brand};font-weight:700;">`)
    // 斜体
    .replace(/<em>/g, `<em style="color:#666;font-style:italic;">`)
    // 链接（微信绿）
    .replace(/<a /g, `<a style="color:${t.linkColor};text-decoration:none;font-weight:500;" `)
    // 图片（v3.0.4 美学优化：圆角和阴影）
    .replace(/<img/g, `<img style="max-width:100%;height:auto;border-radius:${t.imgRadius};box-shadow:${t.imgShadow};display:block;margin:${t.imgMargin};"`);
}

function updateWxPreview(title, markdownContent) {
  const titleEl   = document.getElementById('wx-preview-title');
  const bodyEl    = document.getElementById('wx-preview-body');
  const headerEl  = document.getElementById('wx-side-header');
  const emptyEl   = document.getElementById('wx-empty-placeholder');
  const actionsEl = document.getElementById('wx-side-actions');
  const phoneEl   = document.getElementById('wx-side-phone');
  const badgeEl   = document.getElementById('wx-preview-side-badge') || document.getElementById('wx-side-badge');

  if (titleEl) titleEl.textContent = title || '未命名文章';

  // v2.9.6：更新文章标题块（手机内容顶部大标题）
  const articleTitleBlock = document.getElementById('wx-article-title-block');
  const articleTitleText  = document.getElementById('wx-article-title-text');
  if (articleTitleText) articleTitleText.textContent = title || '未命名文章';
  if (articleTitleBlock) articleTitleBlock.style.display = (title && title !== '未命名文章') ? 'block' : 'none';

  // 渲染 markdown → HTML → 注入 Inline CSS
  if (bodyEl && markdownContent) {
    let rawHtml = typeof marked !== 'undefined'
      ? marked.parse(markdownContent)
      : markdownContent.replace(/\n/g, '<br>');
    // injectWxInlineStyles 已经包含了 H2 处理逻辑（错位叠放效果）
    // 不需要再调用 formatSectionHeadings（会导致 H2 被 div 替换，injectWxInlineStyles 找不到 H2）
    const styledHtml = injectWxInlineStyles(rawHtml);
    bodyEl.innerHTML = styledHtml;
  }

  // 切换空白占位 → 手机框
  if (emptyEl)  emptyEl.style.display  = 'none';
  if (phoneEl)  phoneEl.style.display  = 'block';
  if (headerEl) headerEl.style.display = 'block';
  if (actionsEl) actionsEl.style.display = 'block';

  // 显示右侧 badge
  if (badgeEl) {
    badgeEl.textContent = '已更新';
    badgeEl.classList.add('visible');
  }

  // v3.0.4：初始化风格选择器
  renderStyleSelector();

  // 发布时间（如有）
  const timeEl = document.getElementById('wx-preview-time');
  if (timeEl) {
    const now = new Date();
    timeEl.textContent = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日`;
  }
}

async function sendToWechat() {
  const btn = document.getElementById('btn-send-wx');
  const statusEl = document.getElementById('result-wx-status');
  setLoading(btn, true, '推送中...');
  try {
    const titleEl = document.getElementById('result-title-header');
    const contentEl = document.getElementById('result-content');
    const title = titleEl ? titleEl.textContent.replace('文章已生成', '').trim() || '无标题' : '无标题';
    const content = contentEl ? contentEl.innerText : '';
    const data = await fetchJSON('/api/push-draft', { method: 'POST', body: { title, content } });
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--success)">✓ 已推送微信草稿箱</span>';
    showToast('推送成功！请在微信公众号后台草稿箱查看');
  } catch(err) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger)">⚠️ 推送失败：${escHtml(err.message)}</span>`;
    showToast('推送失败：' + err.message, 'error');
  } finally {
    setLoading(btn, false);
  }
}

// ════════════════════════════════════════════════════════
// 风格切换器（Style Switcher）
// ════════════════════════════════════════════════════════

/**
 * 初始化风格切换器：从 profiles API 加载自定义档案，动态填充 Dropdown 选项
 */
async function initStyleSwitcher() {
  const sel = document.getElementById('style-switcher');
  if (!sel) return;

  try {
    const data = await fetchJSON('/api/profiles');
    const profiles = data.profiles || [];

    // 保留内置选项（yushtang/zaiwang/none），在 zaiwang 之后插入自定义档案
    const insertBefore = sel.querySelector('option[value="none"]');
    const customs = profiles.filter(p => p.id !== 'yushtang' && p.id !== 'zaiwang');

    // 清除旧的自定义选项（防止重复插入）
    sel.querySelectorAll('option.custom-profile-opt').forEach(o => o.remove());

    customs.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.className = 'custom-profile-opt';
      opt.textContent = (p.icon ? p.icon + ' ' : '') + p.name;
      if (insertBefore) {
        sel.insertBefore(opt, insertBefore);
      } else {
        sel.appendChild(opt);
      }
    });
  } catch (e) {
    // 加载失败不影响主流程
    console.warn('[StyleSwitcher] 加载档案失败:', e.message);
  }

  // 触发一次更新，同步 style-info-bar 提示文字
  onStyleSwitcherChange();
}

/**
 * 风格切换器 onChange 回调（v2.9.3 补丁）
 * - 底部提示条格式：「已加载：XX风格」
 * - 顶部右侧副提示：同步显示当前选项
 * - 完全动态，不允许硬编码任何账号名
 */
function onStyleSwitcherChange() {
  const sel      = document.getElementById('style-switcher');
  const infoBar  = document.getElementById('style-info-bar');
  const infoText = document.getElementById('style-info-text');
  const hint     = document.getElementById('style-switcher-hint');
  if (!sel) return;

  const val   = sel.value;
  const label = sel.options[sel.selectedIndex]
    ? sel.options[sel.selectedIndex].text.replace(/^[\u4e00-\u9fa5\u3400-\u4dbf\p{Emoji}\s]+?\s*/u, '')  // 去掉 icon 前缀
    : val;
  // 取可读名称：直接用 option 文本
  const displayName = sel.options[sel.selectedIndex]
    ? sel.options[sel.selectedIndex].text
    : val;

  if (infoBar && infoText) {
    if (val === 'none') {
      infoText.textContent = '未加载风格档案，AI 将使用通用写作风格';
      infoBar.style.opacity = '0.6';
    } else {
      // 统一格式：已加载：XX风格
      infoText.textContent = `已加载：${displayName}风格`;
      infoBar.style.opacity = '1';
    }
  }

  // 右侧副提示同步
  if (hint) {
    hint.textContent = val === 'none'
      ? '通用风格（不注入风格档案）'
      : `已选：${displayName}，Prompt 将注入该档案`;
  }
}

// ════════════════════════════════════════════════════════
// 微信推送（右侧预览区底部按钮调用）
// ════════════════════════════════════════════════════════
async function pushToWechat() {
  const btn = document.querySelector('#wx-side-actions .btn-primary');
  const statusEl = document.getElementById('result-wx-status');
  if (btn) { btn.disabled = true; btn.textContent = '推送中...'; }
  try {
    const titleEl   = document.getElementById('wx-preview-title');
    const contentEl = document.getElementById('wx-preview-body');
    const title   = titleEl   ? titleEl.textContent.trim()   || '无标题' : '无标题';
    // v3.0.2 修复：传递 innerHTML 而不是 innerText，保留图片标签
    const content = contentEl ? contentEl.innerHTML.trim() || '' : '';
    await fetchJSON('/api/push-draft', { method: 'POST', body: { title, content } });
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--success)">✓ 已推送微信草稿箱</span>';
    showToast('推送成功！请在微信公众号后台草稿箱查看');
    // 更新右侧 badge
    const badge = document.getElementById('wx-side-badge');
    if (badge) { badge.textContent = '已推送'; badge.classList.add('visible'); }
  } catch (err) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger)">⚠️ 推送失败：${escHtml(err.message)}</span>`;
    showToast('推送失败：' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:white"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg> 推送到微信草稿箱'; }
  }
}

// ════════════════════════════════════════════════════════
// 工具函数
// ════════════════════════════════════════════════════════
async function fetchJSON(url, options) {
  options = options || {};
  const opts = {
    method:  options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
  };
  if (options.body) opts.body = JSON.stringify(options.body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatSize(bytes) {
  if (bytes < 1024)       return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / 1024 / 1024).toFixed(1) + 'MB';
}

function setLoading(btn, loading, label) {
  if (!btn) return;
  btn.disabled = loading;
  if (loading) {
    btn._origHTML = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span> ' + (label || '处理中...');
  } else {
    btn.innerHTML = btn._origHTML || btn.innerHTML;
  }
}

// ── Toast ──────────────────────────────────────────────
let _toastContainer;

function initToast() {
  _toastContainer = document.createElement('div');
  _toastContainer.id = 'toast';
  document.body.appendChild(_toastContainer);
}

function showToast(message, type) {
  type = type || 'success';
  const item = document.createElement('div');
  item.className = 'toast-item ' + type;
  item.textContent = (type === 'success' ? '✓ ' : '⚠️ ') + message;
  if (_toastContainer) _toastContainer.appendChild(item);
  setTimeout(() => {
    item.style.opacity = '0';
    item.style.transform = 'translateY(8px)';
    item.style.transition = 'all 0.3s';
    setTimeout(() => item.remove(), 300);
  }, 3500);
}
