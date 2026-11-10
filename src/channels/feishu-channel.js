import * as lark from '@larksuiteoapi/node-sdk';
import { createReadStream, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { ChannelAdapter } from './channel-interface.js';
import { splitTextWithCodeFences } from '../protocols/formatter.js';

/**
 * Feishu / Lark channel adapter supporting native WebSocket long connection
 * (no public IP needed), event subscriptions, interactive card streaming, and file delivery.
 */
export class FeishuChannel extends ChannelAdapter {
  constructor(options = {}) {
    super('feishu', options);
    this.appId = options.appId || process.env.FEISHU_APP_ID;
    this.appSecret = options.appSecret || process.env.FEISHU_APP_SECRET;
    this.budget = options.budget ?? 4000;
    this.senderFn = options.senderFn ?? null;

    this.client = null;
    this.wsClient = null;

    if (this.appId && this.appSecret) {
      this.client = new lark.Client({
        appId: this.appId,
        appSecret: this.appSecret,
        // info 级日志会在 MCP stdio 模式下污染协议通道：stdout 只允许 JSON-RPC 输出
        loggerLevel: lark.LoggerLevel.warn,
      });
    }
  }

  async start() {
    if (this.appId && this.appSecret && !this.senderFn) {
      try {
        this.wsClient = new lark.WSClient({
          appId: this.appId,
          appSecret: this.appSecret,
          loggerLevel: lark.LoggerLevel.info,
        });

        // Register incoming message event
        this.wsClient.on('im.message.receive_v1', async (data) => {
          this.#handleIncomingEvent(data);
        });

        await this.wsClient.start();
        this.connected = true;
        return true;
      } catch (err) {
        console.warn(`[FeishuChannel] WSClient failed to start: ${err.message}. Running in offline mode.`);
      }
    }
    this.connected = true;
    return true;
  }

  async stop() {
    this.connected = false;
    if (this.wsClient) {
      try {
        await this.wsClient.stop();
      } catch {}
      this.wsClient = null;
    }
    return true;
  }

  #handleIncomingEvent(data) {
    if (!data || !data.message) return;

    const msg = data.message;
    const chatType = msg.chat_type === 'group' ? 'group' : 'direct';
    const chatKey = msg.chat_id;
    const senderId = data.sender?.sender_id?.open_id || 'unknown_sender';
    const senderName = data.sender?.sender_id?.user_id || senderId;

    let contentText = '';
    if (msg.message_type === 'text') {
      try {
        const parsed = JSON.parse(msg.content);
        contentText = parsed.text || '';
      } catch {
        contentText = msg.content;
      }
    }

    // In group chats, strip bot @mention tag if present
    if (chatType === 'group' && Array.isArray(msg.mentions)) {
      for (const mention of msg.mentions) {
        if (mention.key) {
          contentText = contentText.replace(new RegExp(mention.key, 'g'), '').trim();
        }
      }
    }

    this.dispatchInbound({
      channel: 'feishu',
      chatKey,
      chatType,
      senderId,
      senderName,
      text: contentText,
      attachments: [],
    });
  }

  async sendText(target, text, format = 'plain') {
    const chunks = splitTextWithCodeFences(text, this.budget);
    const messageIds = [];

    for (const chunk of chunks) {
      let payload;
      if (format === 'markdown') {
        payload = {
          msg_type: 'interactive',
          card: {
            header: {
              title: { tag: 'plain_text', content: 'Agent 回复' },
              template: 'blue',
            },
            elements: [
              {
                tag: 'markdown',
                content: chunk,
              },
            ],
          },
        };
      } else {
        payload = {
          msg_type: 'text',
          content: JSON.stringify({ text: chunk }),
        };
      }

      if (typeof this.senderFn === 'function') {
        const res = await this.senderFn(target, payload);
        if (res?.messageId) messageIds.push(res.messageId);
      } else if (this.client) {
        try {
          const receiveIdType = target.startsWith('oc_') ? 'chat_id' : 'open_id';
          const res = await this.client.im.message.create({
            params: { receive_id_type: receiveIdType },
            data: {
              receive_id: target,
              msg_type: payload.msg_type,
              content: typeof payload.content === 'string' ? payload.content : JSON.stringify(payload.card),
            },
          });
          if (res?.data?.message_id) messageIds.push(res.data.message_id);
        } catch (err) {
          throw new Error(`Feishu API send failed: ${err.message}`);
        }
      }
    }

    return { sent: true, messageIds };
  }

  async sendMedia(target, filePath, fileName) {
    if (typeof this.senderFn === 'function') {
      const res = await this.senderFn(target, {
        msg_type: 'file',
        filePath,
        fileName,
      });
      return { sent: true, fileId: res?.fileId || 'fs_file_mock' };
    }

    if (this.client && existsSync(filePath)) {
      try {
        const safeName = fileName || basename(filePath);
        // 1. Upload file to Feishu drive/im
        const uploadRes = await this.client.im.file.create({
          data: {
            file_type: 'stream',
            file_name: safeName,
            file: createReadStream(filePath),
          },
        });
        const fileKey = uploadRes?.data?.file_key;
        if (!fileKey) throw new Error('Feishu file upload returned no file_key');

        // 2. Send file message
        const receiveIdType = target.startsWith('oc_') ? 'chat_id' : 'open_id';
        const msgRes = await this.client.im.message.create({
          params: { receive_id_type: receiveIdType },
          data: {
            receive_id: target,
            msg_type: 'file',
            content: JSON.stringify({ file_key: fileKey }),
          },
        });
        return { sent: true, fileId: msgRes?.data?.message_id || fileKey };
      } catch (err) {
        throw new Error(`Feishu media upload/send failed: ${err.message}`);
      }
    }

    return { sent: true };
  }
}
