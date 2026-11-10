import { resolveConfig } from './config.js';
import { ConversationVault } from './router/conversation-vault.js';
import { MessageDebouncerQueue } from './router/debouncer.js';
import { CommandDispatcher } from './commands/command-parser.js';
import { MediaHub } from './media/media-hub.js';
import { FeishuChannel } from './channels/feishu-channel.js';
import { WeChatChannel } from './channels/wechat-channel.js';
import { DingTalkChannel } from './channels/dingtalk-channel.js';
import { WeComChannel } from './channels/wecom-channel.js';
import { QqChannel } from './channels/qq-channel.js';
import { CliAgentRunner } from './agent-drivers/cli-runner.js';
import { McpAgentServer } from './agent-drivers/mcp-server.js';
import { WebhookAgentServer } from './agent-drivers/webhook-server.js';
import { createInboundMessageEvent } from './protocols/types.js';

/**
 * OmniGateway: Central orchestrator unifying 5 IM channels and 3 Northbound Agent modes.
 */
export class OmniGateway {
  constructor({ config = {}, mockSenders = {} } = {}) {
    this.config = resolveConfig(config);
    this.mockSenders = mockSenders;
    this.customAgentArgs = null;

    // 1. Storage & State Vault
    this.vault = new ConversationVault({
      stateDir: this.config.storage.stateDir,
    });

    // 2. Media Hub
    this.mediaHub = new MediaHub({
      cacheDir: this.config.storage.mediaCacheDir,
    });

    // 3. Active execution runs (for /stop interrupts)
    this.activeRuns = new Map(); // conversationId -> { interrupt: Function }

    // 4. Command Dispatcher
    this.commandDispatcher = new CommandDispatcher({
      vault: this.vault,
      onInterruptTask: (conversationId) => this.#interruptActiveTask(conversationId),
    });

    // 5. Message Debouncer & Task Queue
    this.debouncer = new MessageDebouncerQueue({
      debounceMs: 50, // fast settle for tests, easily configured
      onExecute: (convId, msg) => this.#executeConversationTurn(convId, msg),
    });

    // 6. Southbound Channels
    this.channels = new Map();
    this.#initChannels();

    // 7. Northbound Agent Drivers
    const binaryName = (this.config.agent.binary || '').toLowerCase();
    let detectedAgent = 'claude';
    if (binaryName.includes('codex')) detectedAgent = 'codex';
    else if (binaryName.includes('pi')) detectedAgent = 'pi';

    this.cliRunner = new CliAgentRunner({
      binary: this.config.agent.binary,
      agentType: this.config.agent.agentType || detectedAgent,
      defaultPermissionMode: this.config.agent.permissionLevel,
    });

    this.mcpServer = new McpAgentServer({
      onSendMessage: (target, text, format) => this.deliverOutbound({ conversationId: target, text, format }),
      onSendFile: (target, filePath) => this.deliverOutbound({ conversationId: target, text: '', files: [filePath] }),
      onGetHistory: (target, limit) => ({ messages: this.vault.getHistory(target, limit) }),
    });

    this.webhookServer = new WebhookAgentServer({
      host: this.config.server.host,
      port: this.config.server.port,
      maxBodyBytes: this.config.limits.maxBodyBytes,
      onDeliverMessage: (payload) => this.deliverOutbound(payload),
    });
  }

  #initChannels() {
    const channelClasses = {
      feishu: FeishuChannel,
      wechat: WeChatChannel,
      dingtalk: DingTalkChannel,
      wecom: WeComChannel,
      qq: QqChannel,
    };

    for (const [name, ChannelClass] of Object.entries(channelClasses)) {
      const channelOptions = {
        budget: this.config.limits.channelTextBudget[name],
        senderFn: this.mockSenders[name] ?? null,
        ...(this.config.channels[name] || {}),
      };
      const channel = new ChannelClass(channelOptions);

      channel.on('message', (event) => this.handleInbound(event));
      this.channels.set(name, channel);
    }
  }

  async start() {
    for (const channel of this.channels.values()) {
      await channel.start();
    }
    if (this.config.agent.mode === 'webhook') {
      await this.webhookServer.start();
    }
    return true;
  }

  async stop() {
    // Interupt all running tasks
    for (const conversationId of this.activeRuns.keys()) {
      this.#interruptActiveTask(conversationId);
    }

    for (const channel of this.channels.values()) {
      await channel.stop();
    }

    if (this.webhookServer.server) {
      await this.webhookServer.stop();
    }
    return true;
  }

  #interruptActiveTask(conversationId) {
    this.debouncer.interrupt(conversationId);
    const active = this.activeRuns.get(conversationId);
    if (active && typeof active.interrupt === 'function') {
      active.interrupt();
    }
    this.activeRuns.delete(conversationId);
  }

  /**
   * Main entry point when an inbound message arrives from any of the 5 IM channels.
   */
  async handleInbound(raw) {
    const {
      channel,
      chatKey,
      chatType = 'direct',
      senderId,
      senderName,
      text = '',
      attachments = [],
    } = raw;

    const channelAdapter = this.channels.get(channel);
    if (!channelAdapter) {
      throw new Error(`Unsupported channel: ${channel}`);
    }

    // Security: Check allowlist if configured
    if (Array.isArray(this.config.security?.allowlist)) {
      const allowed = this.config.security.allowlist.includes(senderId) ||
                      this.config.security.allowlist.includes(chatKey);
      if (!allowed) {
        console.warn(`[Security] Ignored message from unlisted sender/chat: ${senderId} (${chatKey})`);
        return { ignored: true, reason: 'not_allowlisted' };
      }
    }

    // Resolve or allocate persistent conversation
    const conversation = this.vault.getOrCreate(channel, chatKey);
    const conversationId = conversation.conversationId;

    // Check slash commands or private batch mode
    const cmdResult = await this.commandDispatcher.dispatch(text, conversation, { chatType });

    if (cmdResult.handled) {
      if (cmdResult.isBatchSubmission) {
        // Enqueue the consolidated batch text for agent execution
        this.debouncer.push(conversationId, {
          text: cmdResult.combinedText,
          attachments,
        });
        return { queued: true, batch: true };
      }

      if (cmdResult.replyText) {
        await channelAdapter.sendText(chatKey, cmdResult.replyText, 'plain');
      }
      return { handled: true, command: true };
    }

    // Regular user message: push to debouncer queue
    this.debouncer.push(conversationId, {
      text,
      attachments,
    });

    return { queued: true };
  }

  /**
   * Internal executor invoked by the debouncer when a conversation turn is ready.
   */
  async #executeConversationTurn(conversationId, combinedMessage) {
    const conversation = this.vault.getById(conversationId);
    if (!conversation) return;

    const channelAdapter = this.channels.get(conversation.channel);
    if (!channelAdapter) return;

    const promptText = combinedMessage.text;
    const workingDir = conversation.workingDirectory || process.cwd();
    const sessionId = conversation.agentSessionId;

    let assistantReply = '';
    let updatedSessionId = sessionId;

    try {
      if (this.config.agent.mode === 'cli') {
        const run = this.cliRunner.execute({
          prompt: promptText,
          cwd: workingDir,
          sessionId,
          model: this.config.agent.model,
          permissionMode: this.config.agent.permissionLevel,
          timeoutMs: this.config.agent.timeoutMs,
          customArgs: this.customAgentArgs,
        });

        this.activeRuns.set(conversationId, { interrupt: run.interrupt });

        for await (const evt of run.events) {
          if (evt.type === 'system' && evt.sessionId) {
            updatedSessionId = evt.sessionId;
          } else if (evt.type === 'text') {
            assistantReply += evt.delta;
          } else if (evt.type === 'done') {
            if (evt.sessionId) updatedSessionId = evt.sessionId;
          }
        }
      } else if (this.config.agent.mode === 'webhook' && this.config.agent.webhookUrl) {
        const inboundPayload = createInboundMessageEvent({
          channel: conversation.channel,
          conversationId,
          chatType: 'direct',
          senderId: 'user',
          text: promptText,
          attachments: combinedMessage.attachments,
        });

        const agentResponse = await this.webhookServer.forwardToAgentWebhook(
          this.config.agent.webhookUrl,
          inboundPayload
        );

        assistantReply = typeof agentResponse === 'string' ? agentResponse : (agentResponse?.text || JSON.stringify(agentResponse));
      }

      // Update session continuity & history
      if (updatedSessionId) {
        this.vault.updateAgentSessionId(conversationId, updatedSessionId);
      }
      if (assistantReply.trim()) {
        this.vault.recordHistory(conversationId, promptText, assistantReply.trim());
        // Deliver reply to the IM channel
        await channelAdapter.sendText(conversation.chatKey, assistantReply.trim(), 'markdown');
      }
    } catch (err) {
      const errorMsg = `任务执行遇到错误：${err?.message || '未知故障'}`;
      await channelAdapter.sendText(conversation.chatKey, errorMsg, 'plain');
    } finally {
      this.activeRuns.delete(conversationId);
    }
  }

  /**
   * Outbound delivery method callable via REST API, MCP tool, or internal services.
   */
  async deliverOutbound({ conversationId, text = '', format = 'plain', files = [] }) {
    // 1. Resolve conversation
    let conversation = this.vault.getById(conversationId);
    if (!conversation) {
      // Support direct chatKey addressing as fallback
      for (const conv of this.vault.conversations.values()) {
        if (conv.chatKey === conversationId) {
          conversation = conv;
          break;
        }
      }
    }

    if (!conversation) {
      throw new Error(`Conversation not found for delivery: ${conversationId}`);
    }

    const channel = this.channels.get(conversation.channel);
    if (!channel) {
      throw new Error(`Channel unavailable: ${conversation.channel}`);
    }

    // 2. Deliver text if present
    if (text && text.trim()) {
      await channel.sendText(conversation.chatKey, text, format);
    }

    // 3. Deliver files / media if present
    const fileIds = [];
    if (Array.isArray(files) && files.length > 0) {
      for (const filePath of files) {
        const staged = await this.mediaHub.stageFile(filePath, conversation.workingDirectory);
        const res = await channel.sendMedia(conversation.chatKey, staged.stagedPath, staged.fileName);
        fileIds.push(res.fileId || staged.fileId);
      }
    }

    return { sent: true, fileIds };
  }
}
