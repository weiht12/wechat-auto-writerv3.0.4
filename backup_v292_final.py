#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""备份 v2.9.2 到 IMA 笔记"""

import os, json, urllib.request, urllib.error, datetime

CLIENT_ID = os.environ.get("IMA_OPENAPI_CLIENTID", "")
API_KEY   = os.environ.get("IMA_OPENAPI_APIKEY", "")

if not CLIENT_ID or not API_KEY:
    print("❌ 缺少 IMA 凭证，环境变量未设置")
    exit(1)

BASE_URL = "https://ima.qq.com/openapi/note/v1"
HEADERS  = {
    "ima-openapi-clientid": CLIENT_ID,
    "ima-openapi-apikey":   API_KEY,
    "Content-Type":         "application/json",
}

today = datetime.date.today().strftime("%Y-%m-%d")

NOTE_CONTENT = f"""# 微信写作助手 v2.9.2 版本备忘录 ({today})

## 版本概要

**版本号**: v2.9.2  
**开发日期**: {today}  
**核心主题**: 交互重构同屏闭环 + 148085 顶级美学 + 配图占位 + 微信兼容Inline CSS  
**基于版本**: v2.9.1（右侧微信预览列 + 风格切换器）

---

## 功能清单

### 1. 交互重构 — 同屏闭环

- **禁止整页跳转**：`renderArticleResult` 中 `scrollIntoView({{ block:'start' }})` 改为 `block:'nearest'`，左栏就近滚动，不做全页跳转
- **`refreshPreview()` 公开接口**：新增全局可调用的 `refreshPreview(title, mdContent)` 函数，直接委托 `updateWxPreview()`，任何位置修改内容后调用即可实时刷新右侧预览
- **数据自动导流**：AI 生成完成 → `renderArticleResult` → `refreshPreview()` → `updateWxPreview()` → 注入右侧微信预览列

### 2. 视觉重置 — 对标 148085 顶级美学

#### WX_TYPOGRAPHY 常量（新增字段）

| 字段 | 值 | 说明 |
|------|----|------|
| `brand` | `#148085` | 品牌蓝绿色（贯穿所有章节标题） |
| `brandContrast` | `#FFFFFF` | 标题色块文字色 |
| `indexFontSize` | `50px` | 章节序号字号 |
| `headingGap` | `-10px` | 序号底部与标题块的物理重合感 |
| `headingMarginLeft` | `8px` | 标题与序号的视觉呼吸感 |
| `imgSlotBg` | `#f5f5f5` | 配图占位槽背景 |

#### 章节序号（大数字，压倒性视觉感）

```css
font-size: 50px !important;
color: #148085 !important;
font-family: sans-serif !important;
font-weight: 700 !important;
margin-bottom: -10px !important;  /* 与标题物理重合 */
```

#### 章节标题行（背景色块）

```css
display: inline-block !important;
background-color: #148085 !important;
padding: 4px 12px !important;
color: #FFFFFF !important;
font-size: 20px !important;
font-weight: bold !important;
margin-left: 8px !important;   /* 序号与标题呼吸感 */
```

#### 正文段落

```css
font-size: 18px;
line-height: 1.75;
color: #333333;
text-align: justify;
letter-spacing: 1px;
margin-top: 20px;
```

### 3. 配图占位逻辑

H2 标题下方自动插入：

```css
width: 100%;
aspect-ratio: 16/9;
background: #f5f5f5;
border-radius: 8px;
margin: 15px 0;
display: flex;
align-items: center;
justify-content: center;
```

文字提示："配图占位 16:9"

### 4. 微信兼容性专项

- `injectWxInlineStyles()` 所有标签均注入 Inline CSS
- 无外部 `<style>` 标签依赖，无 class 依赖
- 直接复制 HTML 到微信公众号后台 100% 还原排版

---

## 文件清单

| 文件 | 变更 |
|------|------|
| `public/app-new.js` | renderArticleResult 去跳转；新增 refreshPreview()；重写 WX_TYPOGRAPHY；重写 injectWxInlineStyles()；重写 formatSectionHeadings() |
| `public/style.css` | 新增 .section-header-148085 / .section-number-148085 / .section-title-148085 CSS 类；article-preview p 正文样式升级；保留旧 .section-header 兼容 |
| `public/index.html` | title + 侧边栏 logo 版本号改为 v2.9.2 |

---

## 恢复方法

如需回滚到 v2.9.1，参考 IMA 备忘录（v2.9.0存档 doc_id: 7442182076112025）或直接从 IMA 恢复相关文件内容。

---

## 下一版本计划（v2.9.3 候选）

- [ ] 配图占位槽支持用户上传/填充真实图片
- [ ] 右侧预览列支持「一键复制 HTML」按钮
- [ ] 样式切换器新增更多预设主题
- [ ] SSE 流式输出时实时刷新右侧预览（逐字注入）
"""

def ima_post(endpoint, payload):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req  = urllib.request.Request(f"{BASE_URL}/{endpoint}", data=data, headers=HEADERS, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return {"error": e.code, "body": body}
    except Exception as ex:
        return {"error": str(ex)}

print("[IMA] 正在备份 v2.9.2...")
result = ima_post("import_doc", {
    "content_format": 1,
    "content": NOTE_CONTENT,
})
print("API 返回:", json.dumps(result, ensure_ascii=False, indent=2))

if result.get("doc_id"):
    print(f"\n[OK] doc_id = {result['doc_id']}")
elif result.get("data", {}).get("doc_id"):
    print(f"\n[OK] doc_id = {result['data']['doc_id']}")
else:
    print("\n[WARN] 备份结果异常，请检查返回值")
