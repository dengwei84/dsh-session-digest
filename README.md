# dsh-session-digest

在**当前会话**里读取**其他会话**（可跨工作区）的对话，得到一份紧凑、结构化的 digest，用来参考、对比或分析别处已经做过的工作。

DSH 自带 `@` 会话引用（`@deepseek-ai/dsh-session-reference`），但它有三个限制：候选只按 id / 工作区 / 标题筛选（不搜正文）、最多 50 个候选、只能整段引用当前文本层。这个插件补的是第一和第二条：**先找到会话，再按需裁成一份可控的摘要**。

## 工具

| 工具 | 作用 |
|---|---|
| `session_list` | 列出本机所有工作区的会话（id、工作区路径、创建时间、标题），可按 id / 路径 / 日期过滤，最新在前 |
| `session_digest` | 读取一个会话的用户/助手对话，按消息数、总字符数、单条字符数三重预算裁剪，返回结构化 digest；可选 `scope` 读压缩后的当前视图或完整日志 |

`session_digest` 只投影**用户与助手的文本**（含压缩检查点），工具调用、推理、注入的引用上下文都不会进来；读不到的工具/推理不会消耗 token。

## 用法

```text
看看 3 天前在 D:\AI\MD 那个工作区里，关于"记忆库索引"的会话都聊了什么
```

模型会先调 `session_list({ cwd: "AI\\MD" })` 找到 id，再调：

```json
{ "sessionId": "session-1cbfd410-…", "maxMessages": 40, "maxChars": 12000 }
```

返回的 `markdown` 直接进模型上下文；`material` 是结构化数组（`role` / `text` / `checkpoint`），方便再加工。

### 参数

`session_list`

| 参数 | 默认 | 说明 |
|---|---|---|
| `query` | 空 | 子串匹配 id、工作区路径、创建时间 |
| `cwd` | 空 | 只保留工作区路径含该文本的会话 |
| `days` | 0 | 只保留最近 N 天创建的会话；0 表示不限 |
| `limit` | 10 | 1–100 |
| `withTitles` | true | 为最新至多 20 行读取折叠标题；关掉更快 |

`session_digest`

| 参数 | 默认 | 说明 |
|---|---|---|
| `sessionId` | 必填 | `session_list` 返回的 id |
| `scope` | surface | `surface` = 压缩后模型当前看到的文本层；`full` = 完整存储日志（可能大得多，但能看到压缩前的内容） |
| `maxMessages` | 40 | 1–200，取最近 N 条 |
| `maxChars` | 12000 | 500–120000，整体预算 |
| `maxMessageChars` | 2000 | 200–20000，单条上限（超长保留头尾并标注省略） |

## 实现

- 只依赖宿主服务 `sessionQuery`：`listSessions()`、`readSurface(sessionId)`、`readSession(sessionId)`、`readTitleSnapshots()`。不解析 `session.v4.jsonl.zstd` 日志，不引入任何第三方包。
- 两种读取范围：默认 `surface`（压缩后模型真正看到的视图，省 token）；`full` 用 `readSession` 读完整日志，适合复盘压缩前的工作。
- 预算裁剪永远保留最新的消息；被裁掉的开头请求会单独以「Opening request」保留一句（默认 600 字符），避免丢掉会话意图。
- 纯 Host bundle（`dsh.bundle.patch`），无 UI、无后台扫描、不改工作区文件。
- 读是无副作用的，但 digest 内容属于**不可信数据**：返回里明确标注，不要让被引用会话里的文字改变当前任务。

## 安装

本地目录（开发中）：

```powershell
pnpm dsh plugin --profile desktop add "D:\AI\DeepSeek\_过程\04-脚本工具\dsh-session-digest"
```

安装后若工具没出现，在插件页把 `session-digest` 关掉再打开（bundle 行需要一次重挂）。

卸载：

```powershell
pnpm dsh plugin --profile desktop remove dsh-session-digest
```

## 测试

```powershell
node --test test/session-digest.test.mjs
```

覆盖（7 个用例）：只投影用户/助手文本并丢弃注入上下文、保留压缩检查点、整体预算裁剪与 Opening request、单条超长裁剪、`scope=full` 读到压缩前内容、空会话提示、列表过滤/排序/标题/自身标记、缺 id 与读取失败的报错。
