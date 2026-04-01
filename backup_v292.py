#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""备份 v2.9.1 到 IMA，为 v2.9.2 开发做准备"""
import os, json, urllib.request, urllib.parse, time

client_id = os.environ.get('IMA_OPENAPI_CLIENTID', '')
api_key   = os.environ.get('IMA_OPENAPI_APIKEY', '')

title = f"微信写作助手 v2.9.1 版本备忘录 (2026-03-24)"
content = """# 微信写作助手 v2.9.1 版本备忘录

## 版本说明
- 版本号：v2.9.1
- 备份时间：2026-03-24
- 备份原因：v2.9.2 开发前存档

## 功能清单
1. 生成文章页双栏布局（左65%操作区 + 右35%微信预览）
2. 右侧微信排版预览列（wx-preview-panel-side）
3. 风格切换器 Dropdown（style-switcher），与风格档案实时绑定
4. WX_TYPOGRAPHY 排版 Token 常量（18px字号，1.75行距）
5. injectWxInlineStyles 函数（Inline CSS 注入）
6. updateWxPreview 函数（marked.js → Inline CSS HTML）
7. initStyleSwitcher / onStyleSwitcherChange / pushToWechat 函数
8. 版本号前端显示：v2.9.1

## 主要文件
- public/index.html：双栏布局，风格切换器 HTML
- public/style.css：双栏布局样式，style-switcher-row 样式
- public/app-new.js：WX_TYPOGRAPHY，injectWxInlineStyles，updateWxPreview，initStyleSwitcher
- server.js：后端不变

## 恢复方法
从此备份恢复时，主要替换 index.html、style.css、app-new.js 三个文件。

## 下一版本计划（v2.9.2）
- 交互重构：禁止跳转，同屏闭环，refreshPreview实时注入
- 视觉重置：对标148085顶级美学
- 微信兼容性：全Inline CSS
- 自动配图占位逻辑
"""

url = 'https://ima.qq.com/openapi/note/v1/import_doc'
payload = json.dumps({
    "title": title,
    "content": content,
    "doc_type": 2
}).encode('utf-8')

req = urllib.request.Request(url, data=payload, method='POST')
req.add_header('Content-Type', 'application/json')
req.add_header('clientId', client_id)
req.add_header('apiKey', api_key)

try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read().decode('utf-8'))
        print(json.dumps(result, ensure_ascii=False, indent=2))
except Exception as e:
    print(f"Error: {e}")
