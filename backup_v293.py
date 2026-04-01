#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os, json, urllib.request, urllib.error, datetime

CLIENT_ID = os.environ.get("IMA_OPENAPI_CLIENTID", "")
API_KEY   = os.environ.get("IMA_OPENAPI_APIKEY", "")
BASE_URL  = "https://ima.qq.com/openapi/note/v1"
HEADERS   = {
    "ima-openapi-clientid": CLIENT_ID,
    "ima-openapi-apikey":   API_KEY,
    "Content-Type":         "application/json",
}
today = datetime.date.today().strftime("%Y-%m-%d")

NOTE_CONTENT = f"""# v2.9.2 开发前存档 ({today}) — v2.9.3 备份点

## 版本说明

这是 v2.9.3 开发前对 v2.9.2 的快照存档。如需回滚，参考此文件恢复。

## v2.9.2 核心功能清单

- 交互重构：renderArticleResult 禁止全页跳转，refreshPreview() 公开接口
- 148085 顶级美学：章节序号50px品牌色 + 标题色块 + 正文18px/1.75/justify
- 配图占位：H2下方自动插入16:9灰色占位槽
- 微信兼容：injectWxInlineStyles 全 Inline CSS，无外部依赖

## v2.9.3 待开发（本次备份后开始）

- 删除生成后跳转逻辑，文章直接渲染在中栏编辑框
- 中栏独立滚动条，支持长文编辑
- 预览区宽度 >= 35%，大屏手机阅读体验
- 中栏编辑内容实时同步右侧预览
- 章节序号错位叠放效果强化
- 正文 Inline CSS 锁死规范
"""

def ima_post(endpoint, payload):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req  = urllib.request.Request(f"{BASE_URL}/{endpoint}", data=data, headers=HEADERS, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as ex:
        return {"error": str(ex)}

print("[IMA] 备份 v2.9.2 存档（v2.9.3 开发前）...")
result = ima_post("import_doc", {"content_format": 1, "content": NOTE_CONTENT})
print("返回:", json.dumps(result, ensure_ascii=False, indent=2))
doc_id = result.get("doc_id") or result.get("data", {}).get("doc_id")
if doc_id:
    print(f"[OK] doc_id = {doc_id}")
else:
    print("[WARN] 请检查返回值")
