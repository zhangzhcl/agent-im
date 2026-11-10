import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Command dispatcher handling chat slash commands and private-chat batch input modes.
 */
export class CommandDispatcher {
  constructor({ vault, onInterruptTask }) {
    this.vault = vault;
    this.onInterruptTask = onInterruptTask;

    // conversationId -> Array<string> of collected text messages
    this.batchCollectors = new Map();
  }

  isCommand(text) {
    if (typeof text !== 'string') return false;
    const trimmed = text.trim();
    return trimmed.startsWith('/') || this.batchCollectors.has(text);
  }

  isBatchCollecting(conversationId) {
    return this.batchCollectors.has(conversationId);
  }

  async dispatch(rawText, conversation, { chatType = 'direct' } = {}) {
    const text = String(rawText ?? '').trim();
    const conversationId = conversation.conversationId;

    // 1. Check if currently in batch input mode for this conversation
    if (this.batchCollectors.has(conversationId)) {
      if (text.toLowerCase() === '/send') {
        const collected = this.batchCollectors.get(conversationId);
        this.batchCollectors.delete(conversationId);
        if (collected.length === 0) {
          return { handled: true, replyText: '当前暂存区为空，没有待提交的消息。' };
        }
        return {
          handled: true,
          isBatchSubmission: true,
          combinedText: collected.join('\n'),
        };
      }

      if (text.toLowerCase() === '/cancel') {
        this.batchCollectors.delete(conversationId);
        return { handled: true, replyText: '已取消批处理模式，暂存消息已全部清空。' };
      }

      if (text.toLowerCase() === '/batch') {
        const count = this.batchCollectors.get(conversationId).length;
        return { handled: true, replyText: `当前正在暂存模式中，已暂存 ${count}/10 条消息。发送 /send 提交，或 /cancel 取消。` };
      }

      // If user sends another slash command while in batch mode, prompt them
      if (text.startsWith('/')) {
        return { handled: true, replyText: '当前正在批处理暂存模式中，请先输入 /send 提交或 /cancel 退出后再执行其他命令。' };
      }

      // Otherwise, collect this message
      const list = this.batchCollectors.get(conversationId);
      if (list.length >= 10) {
        return { handled: true, replyText: '暂存区已达上限（10条）。请发送 /send 提交本次批处理，或发送 /cancel 放弃。' };
      }

      list.push(text);
      return { handled: true, replyText: `已暂存 ${list.length}/10 条消息。继续输入或发送 /send 提交。` };
    }

    // 2. Normal slash commands
    if (!text.startsWith('/')) {
      return { handled: false };
    }

    const [cmdToken, ...args] = text.split(/\s+/);
    const cmd = cmdToken.toLowerCase();
    const argStr = args.join(' ').trim();

    switch (cmd) {
      case '/help': {
        return {
          handled: true,
          replyText: [
            '【常用指令列表】',
            '• /new - 重置会话上下文并开启全新会话',
            '• /status - 查看当前网关与工作区状态',
            '• /cd <路径> - 切换当前聊天绑定的工作目录',
            '• /stop - 中止当前正在运行的任务',
            '• /history [条数] - （限私聊）查看最近历史记录（1~5条）',
            '• /batch - （限私聊）开启多条消息暂存合并模式',
            '• /send - （限私聊）提交暂存的多条消息',
            '• /cancel - （限私聊）清空并退出暂存模式',
            '• /help - 查看本帮助信息',
          ].join('\n'),
        };
      }

      case '/status': {
        const latest = this.vault.getById(conversationId);
        return {
          handled: true,
          replyText: [
            '【当前会话状态】',
            `• 接入渠道: ${latest.channel}`,
            `• 会话标识: ${latest.conversationId}`,
            `• 绑定工作区: ${latest.workingDirectory}`,
            `• 智能体会话ID: ${latest.agentSessionId || '未建立 (下次输入将创建新会话)'}`,
          ].join('\n'),
        };
      }

      case '/new': {
        this.vault.resetSession(conversationId);
        if (typeof this.onInterruptTask === 'function') {
          this.onInterruptTask(conversationId);
        }
        return {
          handled: true,
          replyText: '当前聊天会话已重置。下一条发送的普通消息将开启全新的上下文对话。',
        };
      }

      case '/cd':
      case '/workspace': {
        if (!argStr) {
          const current = this.vault.getById(conversationId);
          return { handled: true, replyText: `当前工作目录为：${current.workingDirectory}\n切换请输入：/cd <目标绝对路径>` };
        }

        const targetDir = resolve(argStr);
        if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) {
          return { handled: true, replyText: `切换失败：目标目录不存在或非文件夹：${argStr}` };
        }

        this.vault.setWorkingDirectory(conversationId, targetDir);
        return { handled: true, replyText: `工作目录已切换至：${targetDir}` };
      }

      case '/stop': {
        if (typeof this.onInterruptTask === 'function') {
          this.onInterruptTask(conversationId);
        }
        return { handled: true, replyText: '已发送任务中止信号。当前正在执行的任务已取消。' };
      }

      case '/batch': {
        if (chatType !== 'direct') {
          return { handled: true, replyText: '批处理暂存功能仅限私聊可用，群聊不支持此操作。' };
        }
        this.batchCollectors.set(conversationId, []);
        return { handled: true, replyText: '已开启多条消息暂存模式。后续输入的每条消息将自动暂存（上限10条），输入 /send 统一提交，输入 /cancel 放弃。' };
      }

      case '/send': {
        if (chatType !== 'direct') {
          return { handled: true, replyText: '批处理提交功能仅限私聊可用。' };
        }
        return { handled: true, replyText: '当前没有进行中的批处理暂存任务。输入 /batch 开启。' };
      }

      case '/cancel': {
        if (chatType !== 'direct') {
          return { handled: true, replyText: '批处理取消功能仅限私聊可用。' };
        }
        return { handled: true, replyText: '当前没有进行中的批处理暂存任务。' };
      }

      case '/history': {
        if (chatType !== 'direct') {
          return { handled: true, replyText: '历史查看功能仅限私聊可用，群聊不支持此操作。' };
        }

        let count = 3;
        if (argStr) {
          const parsed = parseInt(argStr, 10);
          if (!isNaN(parsed) && parsed > 0) {
            count = Math.min(parsed, 5);
          }
        }

        const history = this.vault.getHistory(conversationId, count);
        if (history.length === 0) {
          return { handled: true, replyText: '当前会话暂无历史问答记录。' };
        }

        const lines = ['【最近历史记录回顾】'];
        history.forEach((item, index) => {
          lines.push(`\n[第 ${index + 1} 轮]`);
          lines.push(`问：${item.user}`);
          lines.push(`答：${item.assistant}`);
        });
        return { handled: true, replyText: lines.join('\n') };
      }

      default:
        return { handled: false };
    }
  }
}
