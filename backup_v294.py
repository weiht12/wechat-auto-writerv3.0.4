#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""backup_v294.py — v2.9.3 IMA 备份（v2.9.4 开发前存档）"""
import os, urllib.request, json, datetime

CLIENT_ID = os.environ.get("IMA_OPENAPI_CLIENTID", "")
API_KEY   = os.environ.get("IMA_OPENAPI_APIKEY", "")
API_URL   = "https://ima.qq.com/openapi/note/v1/import_doc"
TODAY     = datetime.date.today().strftime("%Y-%m-%d")

TITLE   = f"[wechat-auto-writer] v2.9.3 备份 ({TODAY})"
CONTENT = """# v2.9.3 版本备忘录

## 版本信息
- 版本号: v2.9.3 (v2.9.4 开发前备份)
- 备份时间: """ + TODAY + """

## v2.9.3 核心改动
1. 删除跳转逻辑：文章生成后直接渲染在中栏 contenteditable 编辑框
2. 中栏独立滚动条：max-height:calc(100vh-340px)，品牌色细滚动条
3. 预览区加宽：35% -> 38%，手机卡片 max-width:360px
4. 中栏编辑实时同步：input事件 + 防抖300ms -> refreshPreview
5. 错位叠放：序号 position:relative，标题色块 margin-top:-14px 叠压
6. 正文全 Inline CSS：18px/1.75行高/justify/字间距1px
7. 风格显示冲突修复（v2.9.3补丁）：
   - 删除HTML硬编码"豫事堂"字样
   - onStyleSwitcherChange统一为"已加载：XX风格"格式
   - server.js /api/write 修复根本bug：解构加profileId，按PROFILES_DIR加载正确档案
   - 进度提示动态显示档案名

## 主要文件
- public/index.html
- public/app-new.js
- public/style.css
- server.js

## 恢复方式
从本 IMA 笔记复制代码，或查看 git 历史。
"""

def backup():
    print("[IMA] 正在备份 v2.9.3 到 IMA...")
    payload = json.dumps({
        "clientId": CLIENT_ID,
        "apiKey":   API_KEY,
        "title":    TITLE,
        "content":  CONTENT,
        "type":     "markdown"
    }).encode("utf-8")
    req = urllib.request.Request(
        API_URL,
        data    = payload,
        headers = {"Content-Type": "application/json; charset=utf-8"},
        method  = "POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8"))
        print("[Result]", json.dumps(result, ensure_ascii=False, indent=2))
        doc_id = result.get("doc_id") or result.get("data", {}).get("doc_id")
        if doc_id:
            print(f"\n[OK] v2.9.3 备份成功！doc_id = {doc_id}")
        else:
            print("\n[WARN] 备份结果异常，请检查返回值")
    except Exception as e:
        print(f"[ERROR] {e}")

if __name__ == "__main__":
    backup()
