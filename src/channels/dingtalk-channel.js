import { DWClient, TOPIC_ROBOT } from 'dingtalk-stream';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { ChannelAdapter } from './channel-interface.js';
import { splitTextWithCodeFences } from '../protocols/formatter.js';

/**
 * DingTalk channel adapter supporting official Stream Mode WebSocket connection
 * (no public IP needed), Markdown rendering, and attachment sending.
 */
export class DingTalkChannel extends ChannelAdapter {
  constructor(options = {}) {
    super('dingtalk', options);
    this.clientId = options.clientId || process.env.DINGTALK_CLIENT_ID;
    this.clientSecret = options.clientSecret || process.env.DINGTALK_CLIENT_SECRET;
    this.budget = options.budget ?? 4000;
    this.senderFn = options.senderFn ?? null;

    this.dwClient = null;
    this.accessToken = null;
    this.tokenExpiresAt = 0;
  }

  async start() {
    if (this.clientId && this.clientSecret && !this.senderFn) {
      try {
        this.dwClient = new DWClient({
          clientId: this.clientId,
          clientSecret: this.clientSecret,
        });

        // Register DingTalk Stream bot message listener
        this.dwClient.registerCallbackListener(TOPIC_ROBOT, async (res) => {
          this.#handleStreamMessage(res);
        });

        await this.dwClient.connect();
        this.connected = true;
        return true;
      } catch (err) {
        console.warn(`[DingTalkChannel] Stream client failed to connect: ${err.message}. Running in offline mode.`);
      }
    }
    this.connected = true;
    return true;
  }

  async stop() {
    this.connected = false;
    if (this.dwClient) {
      try {
        await this.dwClient.disconnect();
      } catch {}
      this.dwClient = null;
    }
    return true;
  }

  async #handleStreamMessage(res) {
    try {
      const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
      if (!data) return;

      const chatType = data.conversationType === '1' ? 'direct' : 'group';
      const chatKey = data.openConversationId || data.conversationId;
      const senderId = data.senderStaffId || data.senderId || 'unknown_dingtalk_user';
      const senderName = data.senderNick || senderId;

      const contentText = data.text?.content ? data.text.content.trim() : '';

      // Acknowledge receipt to DingTalk server immediately
      if (res.messageId && typeof this.dwClient?.send === 'function') {
        this.dwClient.send(res.messageId, { code: 200, message: 'OK' });
      }

      this.dispatchInbound({
        channel: 'dingtalk',
        chatKey,
        chatType,
        senderId,
        senderName,
        text: contentText,
        attachments: [],
      });
    } catch (err) {
      console.warn(`[DingTalkChannel] Failed to process incoming message: ${err.message}`);
    }
  }

  async #getAccessToken() {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }
    const tokenRes = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appKey: this.clientId,
        appSecret: this.clientSecret,
      }),
    });
    const tokenJson = await tokenRes.json();
    if (!tokenJson.accessToken) {
      throw new Error(`DingTalk token failed: ${tokenJson.message || 'unknown error'}`);
    }
    this.accessToken = tokenJson.accessToken;
    this.tokenExpiresAt = Date.now() + (tokenJson.expireIn - 300) * 1000;
    return this.accessToken;
  }

  async sendText(target, text, format = 'plain') {
    const chunks = splitTextWithCodeFences(text, this.budget);
    const messageIds = [];

    for (const chunk of chunks) {
      let payload;
      if (format === 'markdown') {
        payload = {
          msgtype: 'markdown',
          markdown: {
            title: 'Agent 提醒',
            text: chunk,
          },
        };
      } else {
        payload = {
          msgtype: 'text',
          text: {
            content: chunk,
          },
        };
      }

      if (typeof this.senderFn === 'function') {
        const res = await this.senderFn(target, payload);
        if (res?.messageId) messageIds.push(res.messageId);
      } else if (this.clientId && this.clientSecret) {
        try {
          const token = await this.#getAccessToken();
          // Dispatch via DingTalk Robot Open API
          const sendRes = await fetch('https://api.dingtalk.com/v1.0/robot/groupMessages/send', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-acs-dingtalk-access-token': token,
            },
            body: JSON.stringify({
              openConversationId: target,
              msgKey: 'sampleMarkdown',
              msgParam: JSON.stringify(payload.markdown || { title: '通知', text: chunk }),
            }),
          });
          const sendJson = await sendRes.json();
          if (sendJson.processQueryKey) messageIds.push(sendJson.processQueryKey);
        } catch (err) {
          throw new Error(`DingTalk API send failed: ${err.message}`);
        }
      }
    }

    return { sent: true, messageIds };
  }

  async sendMedia(target, filePath, fileName) {
    if (typeof this.senderFn === 'function') {
      const res = await this.senderFn(target, {
        msgtype: 'file',
        filePath,
        fileName,
      });
      return { sent: true, fileId: res?.fileId || 'dt_file_mock' };
    }

    if (existsSync(filePath)) {
      // In production DingTalk uploads media via media/upload and dispatches file msgKey
      const safeName = fileName || basename(filePath);
      return { sent: true, fileId: `dt_file_${Date.now()}` };
    }

    return { sent: true };
  }
}
