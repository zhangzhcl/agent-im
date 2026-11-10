# Omni IM Gateway

多渠道 IM 智能网关：把**飞书 / 微信 / 钉钉 / 企业微信 / QQ** 五大 IM 平台接入各类 AI Agent。你在手机聊天窗口发一句话，家里或公司电脑上的 Agent 就开始干活，并把结果（含文件）直接回传到聊天窗口。

向下统一封装五个 IM 平台的协议差异；向上支持三类 Agent 接入方式：

| 接入模式 | 适用 Agent | 说明 |
| :--- | :--- | :--- |
| 模式 A：CLI 原生引擎 | Claude Code / Codex CLI / Pi CLI | 网关以子进程唤起 CLI，解析流式事件，自动跟踪 sessionId 保持多轮上下文 |
| 模式 B：标准 MCP | Cursor / Claude Desktop / ChatGPT Desktop | 网关作为 MCP 服务器（stdio），Agent 主动向 IM 发消息、发文件、读历史 |
| 模式 C：Webhook / REST | Dify / FastGPT / Python / Go 自研 | 入站消息 POST 到你的 Webhook，出站调用网关 REST API 下发 |

---

## 一、功能特性

- **多渠道归一**：五个平台一套事件模型，渠道适配器结构开放，可自行扩展新平台；
- **会话连续性**：每个聊天绑定独立会话状态与工作目录，跨消息轮次保持 Agent 上下文（`--resume`）；
- **消息消抖与串行队列**：短时间连发的多条消息自动聚合为一个输入回合，同会话任务严格排队，`/stop`、`/new` 等控制指令即刻打断；
- **跨分段代码围栏补全**：长回复按平台字符预算分段时，断点落在代码块内部会自动闭合并在下段续接语言围栏，排版不崩溃；
- **媒体安全快照**：Agent 产出的文件发送前做 SHA-256 校验并独立快照，Agent 后续改动工作区不影响已送达文件的完整性；
- **超时与进程树终止**：`timeoutMs` 到期按进程树终止 Agent（含其派生的工具子进程），按时上报，不留孤儿进程；
- **来源白名单**：`security.allowlist` 限定允许触发 Agent 的发送者与聊天。

---

## 二、系统架构

```
                ┌────────────────────────────────────────────────────────┐
                │    五大 IM 平台 (飞书 / 微信 / 钉钉 / 企业微信 / QQ)     │
                └───────────────────────────┬────────────────────────────┘
                                            │
                ┌───────────────────────────▼────────────────────────────┐
                │               Omni IM Gateway (核心网关)               │
                │  • 多渠道协议归一化 (Feishu, WeChat, DingTalk, WeCom, QQ)│
                │  • 会话隔离与连续性保持 (ConversationVault)             │
                │  • 异步任务消抖与串行队列 (MessageDebouncerQueue)        │
                │  • 媒体中转与文件快照管线 (MediaHub)                   │
                │  • 控制命令引擎 (/new, /status, /cd, /stop, /batch)    │
                │  • Markdown 格式自适应与跨段代码围栏补全 (Formatter)    │
                └───────────────────────────┬────────────────────────────┘
                                            │
     ┌──────────────────────────────────────┼──────────────────────────────────────┐
     │                                      │                                      │
┌────▼───────────────┐             ┌─────────▼──────────────┐             ┌─────────▼──────────────┐
│ 模式 A: CLI 原生引擎 │             │   模式 B: 标准 MCP     │             │ 模式 C: Webhook / REST │
│ (Claude Code/Codex/Pi)│          │ (Cursor/Claude Desktop)│             │ (Dify/FastGPT/自研Agent)│
└─────────────────────┘             └────────────────────────┘             └────────────────────────┘
```

---

## 三、安装

### 前置要求

- Node.js >= 20.12.0（`node -v` 确认）；
- 至少一个 IM 渠道的机器人凭据（见[渠道接入](#五渠道接入)）；
- 模式 A 需要本机已安装对应 CLI（如 `claude`，`claude --version` 可用）。

### 方式一：npm 全局安装（推荐）

```bash
npm install -g omni-im-gateway

# 启动网关（默认读取 ./config.json，或用 --config 指定）
omni-im-gateway start --config /path/to/config.json

# 以 MCP stdio 模式运行（供 Cursor / Claude Desktop 调用）
omni-im-gateway mcp --config /path/to/config.json
```

### 方式二：npx 免安装运行

```bash
npx omni-im-gateway start --config /path/to/config.json

# 也可以直接从 GitHub 源运行
npx github:zhangzhcl/agent-im start --config /path/to/config.json
```

### 方式三：源码安装

```bash
git clone https://github.com/zhangzhcl/agent-im.git
cd agent-im
npm install
node bin/cli.js start --config config.json
```

### 方式四：Docker

```bash
git clone https://github.com/zhangzhcl/agent-im.git
cd agent-im
cp config.example.json config.json   # 按需修改
docker compose up -d
```

---

## 四、快速开始

以「飞书 + Claude Code」为例，四步跑通：

1. **建飞书应用**：在[飞书开放平台](https://open.feishu.cn/)创建企业自建应用，获取 `App ID` / `App Secret`，订阅「接收消息」事件（长连接模式），并开通消息发送权限；
2. **写配置文件**：

   ```json
   {
     "agent": {
       "mode": "cli",
       "binary": "claude",
       "permissionLevel": "dontAsk",
       "timeoutMs": 300000
     },
     "security": {
       "allowlist": ["ou_xxx你的飞书open_id"]
     },
     "channels": {
       "feishu": {
         "appId": "cli_xxx",
         "appSecret": "your_secret"
       }
     }
   }
   ```

3. **启动**：`omni-im-gateway start --config config.json`，看到网关运行日志即表示飞书长连接已建立；
4. **在飞书里给机器人发消息**：先发 `/status` 查看状态，再发一句自然语言（如“帮我看下当前目录有什么文件”），Agent 执行后回复结果。

### 配置项总表

| 字段 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `server.host` | `127.0.0.1` | Webhook 模式监听地址，保持本机回环最安全 |
| `server.port` | `8080` | Webhook 模式监听端口 |
| `agent.mode` | `cli` | `cli` / `mcp` / `webhook` 三选一 |
| `agent.agentType` | 自动识别 | 显式指定 `claude` / `codex` / `pi`，缺省按 binary 名推断 |
| `agent.binary` | `claude` | CLI 可执行文件名或绝对路径 |
| `agent.permissionLevel` | `dontAsk` | 传给 Claude Code 的 `--permission-mode` |
| `agent.model` | 无 | 指定模型 |
| `agent.timeoutMs` | `180000` | 单次 Agent 任务超时，到期按进程树终止 |
| `agent.webhookUrl` | 无 | 模式 C 下入站消息转发地址 |
| `security.allowlist` | 缺失 | 发送者 / 聊天白名单，见下方安全说明 |
| `storage.stateDir` | `~/.omni-im-gateway` | 会话状态持久化目录，多项目部署建议显式指定 |
| `storage.mediaCacheDir` | `<stateDir>/media` | 媒体快照缓存目录 |
| `limits.maxBodyBytes` | `1048576` | Webhook 请求体上限 |
| `limits.maxConcurrentProcesses` | `10` | 并发 Agent 子进程上限 |
| `limits.channelTextBudget.*` | 按渠道 | 各渠道单条消息字符预算（微信 1800 等） |
| `channels.feishu` | 无 | `appId` / `appSecret` |
| `channels.dingtalk` | 无 | `clientId` / `clientSecret`（Stream 模式） |
| `channels.wecom` | 无 | 智能机器人凭据（`@wecom/aibot-node-sdk`） |
| `channels.qq` | 无 | `appId` / `clientSecret`（官方机器人） |
| `channels.wechat` | 无 | `bridgeUrl`，指向自建微信桥接服务 |

### 安全说明（务必阅读）

- **permissionLevel**：默认 `dontAsk`。`bypassPermissions` 会让 IM 侧指令跳过全部执行确认，等于把电脑的完整控制权交给出资人，仅建议在完全可信的封闭网络中使用；
- **allowlist 三态语义**：**字段缺失** = 不拦截（任何发送者都可触发）；**非空数组** = 仅允许列表内的 `senderId` 或 `chatKey`；**空数组 `[]` 或保留占位符** = 拦截所有人。启用前请确认已填入真实 ID；
- **server.host** 保持 `127.0.0.1`，除非明确需要局域网访问 Webhook API。

---

## 五、渠道接入

### 飞书

开放平台创建企业自建应用，填 `appId` / `appSecret`。网关使用官方 WebSocket 长连接接收消息，无需公网 IP。需要事件订阅 `im.message.receive_v1` 与消息发送权限。

### 钉钉

开放平台创建应用，开通机器人，填 `clientId` / `clientSecret`。使用官方 `dingtalk-stream` 长连接，无需公网 IP。

### 企业微信

使用智能机器人（`@wecom/aibot-node-sdk`），填对应凭据，官方 WebSocket 长连接。

### QQ

QQ 开放平台创建机器人，填 `appId` / `clientSecret`，使用官方 `@tencent-connect/qqbot-nodejs` SDK。

### 微信

微信官方未提供个人号机器人 API。本项目不做协议实现，通过 `bridgeUrl` 对接**你自建的桥接服务**，桥接需提供两个 HTTP 接口：

```
POST {bridgeUrl}/api/send       { "toUserId": "...", "content": "..." }
POST {bridgeUrl}/api/send-file  { "toUserId": "...", "filePath": "...", "fileName": "..." }
```

桥接服务的实现方式（协议库、合规性、封号风险）由提供方自行负责，请评估后再使用。

---

## 六、Agent 接入模式详解

### 模式 A：CLI 原生引擎（Claude Code / Codex / Pi）

适合人在外、通过手机 IM 远程指挥本地电脑。网关以非交互子进程唤起 CLI（如 `claude -p --output-format stream-json --resume <sessionId>`），解析流式事件（思考过程、工具调用、文本增量）回复到 IM 窗口，并自动跟踪 sessionId 保证多轮上下文连贯。

### 模式 B：标准 MCP（Cursor / Claude Desktop）

网关作为 MCP 服务器（stdio），提供三个工具：

- `send_im_message({ target, text, format })`：发送文字或 Markdown；
- `send_im_file({ target, filePath })`：将本地文件发送到指定聊天；
- `get_im_history({ target, limit })`：读取指定聊天最近的历史问答。

客户端配置（MCP 客户端启动目录不可控，用环境变量指定配置）：

```json
{
  "mcpServers": {
    "omni-im-gateway": {
      "command": "omni-im-gateway",
      "args": ["mcp"],
      "env": { "OMNI_IM_GATEWAY_CONFIG": "/absolute/path/to/config.json" }
    }
  }
}
```

源码方式则把 `command` 换成 `node`、`args` 换成 `["/path/to/agent-im/bin/cli.js", "mcp"]`。

注意：MCP 模式不建立 IM 入站长连接（入站由 `start` 模式的常驻进程独占），多个 MCP 客户端同时连接不会重复消费消息。

### 模式 C：Webhook / REST（Dify / FastGPT / 自研）

- **入站**：网关收到用户消息后，向 `agent.webhookUrl` 发送标准 JSON POST；
- **出站**：Agent 计算完毕后调用网关 API 下发消息与产物：

```bash
curl -X POST http://127.0.0.1:8080/api/v1/messages/send \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "conv_feishu_xxxx",
    "text": "任务处理完毕，详细报表如下：",
    "format": "markdown",
    "files": ["/tmp/report.xlsx"]
  }'
```

---

## 七、聊天指令

在任意已接入渠道的聊天窗口直接发送：

| 指令 | 说明 | 适用范围 |
| :--- | :--- | :--- |
| `/new` | 重置会话上下文，下一条输入开启全新对话 | 私聊 / 群聊 |
| `/status` | 查看网关连接状态、当前会话标识、工作目录、会话 ID | 私聊 / 群聊 |
| `/cd <路径>` | 切换当前聊天绑定的工作空间目录 | 私聊 / 群聊 |
| `/stop` | 立即中断当前正在运行的 Agent 任务 | 私聊 / 群聊 |
| `/history [N]` | 回显当前会话最近 N 条（1~5，默认 3）真实问答 | 仅限私聊 |
| `/batch` | 开启多条消息暂存模式（上限 10 条） | 仅限私聊 |
| `/send` | 将暂存的多条消息合并提交给 Agent | 仅限私聊 |
| `/cancel` | 清空暂存区并退出批处理模式 | 仅限私聊 |
| `/help` | 查看完整帮助说明 | 私聊 / 群聊 |

---

## 八、常见问题

**Q：Windows 下启动 CLI Agent 报找不到命令？**
`binary` 填 `.exe` 完整路径最稳；非 `.exe` 命令会经 shell 包装解析（PATH 需可见）。

**Q：任务卡住不返回？**
配置 `agent.timeoutMs`。超时触发后网关按进程树终止 Agent（Windows `taskkill /T`，POSIX 进程组信号），并立即向聊天窗口上报超时错误，不会遗留孤儿进程。

**Q：MCP 客户端连接后报解析错误？**
MCP stdout 仅输出 JSON-RPC。若自行扩展代码，不要向 stdout 打印日志（用 stderr）。

**Q：多台电脑 / 多个项目怎么隔离？**
各自用独立的 `storage.stateDir`，避免会话状态混在同一个 `~/.omni-im-gateway/` 下。

---

## 九、开发与测试

```bash
npm install
npm test          # 全量单元测试（node:test）
npm pack          # 本地打包验证发布内容
node bin/cli.js start   # 本地启动
```

项目结构：

```
bin/cli.js                 CLI 入口（start / mcp 双模式）
mcp-entry.mjs              独立 MCP 入口（部署场景）
src/gateway.js             核心编排：渠道、会话、队列、Agent 驱动
src/channels/              五渠道适配器（ChannelAdapter 基类可扩展）
src/agent-drivers/         CLI 子进程执行器 / MCP 服务器 / Webhook 服务器
src/router/                会话保险库与消抖串行队列
src/commands/              聊天指令解析
src/protocols/             消息格式化与分段
src/media/                 文件快照与媒体中转
tests/                     单元测试
```

---

## 许可证

[MIT](./LICENSE)
