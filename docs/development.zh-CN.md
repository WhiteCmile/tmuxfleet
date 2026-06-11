# 开发

[English](development.md) | [返回 README](../README.zh-CN.md)

## 项目说明

- `README.md` 是英文主文档。每次修改它时，需要在同一个变更里同步更新
  `README.zh-CN.md`。
- 浏览器侧 UI 文案在 `src/views.js`。
- Hub 会在每次页面请求时动态加载 `src/views.js`，所以只改 UI 文案或样式时
  通常刷新浏览器即可。
- 后端/API 改动需要重启 Hub/Node 进程，或使用 `node --watch`。
- 项目刻意不使用 npm runtime dependencies。除非明显有必要，否则优先使用
  Node.js built-in modules。

## Watch 模式

```bash
TMUXFLEET_HUB_TOKEN=test-token TMUXFLEET_NODE_TOKEN=test-token \
npm run dev:hub -- --host 127.0.0.1 --port 8090
```

## 验证

语法检查和测试：

```bash
npm run check
```
