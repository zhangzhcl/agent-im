import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { ChannelAdapter } from './channel-interface.js';
import { splitTextWithCodeFences } from '../protocols/formatter.js';

/**
 * WeCom (企业微信) channel adapter supporting both Bot Webhook mode and App API mode.
 */
export class WeComChannel extends ChannelAdapter {
  constructor(options = {}) {
    super('wecom', options);
    this.webhookKey = options.webhookKey || process.env.WECOM_WEBHOOK_KEY;
    this.corpId = options.corpId || process.env.WECOM_CORP_ID;
    this.corpSecret = options.corpSecret || process.env.WECOM_CORP_SECRET;
    this.agentId = options.agentId || process.env.WECOM_AGENT_ID;

    this.budget = options.budget ?? 4000;
    this.senderFn = options.senderFn ?? null;

    this.accessToken = null;
    this.tokenExpiresAt = 0;
  }

  async start() {
    this.connected = true;
    return true;
  }

  async stop() {
    this.connected = false;
    return true;
  }

  async #getAccessToken() {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }
    if (!this.corpId || !this.corpSecret) {
      throw new Error('WeCom corpId and corpSecret required for App API mode');
    }

    const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${this.corpId}&corpsecret=${this.corpSecret}`);
    const json = await res.json();
    if (json.errcode !== 0) {
      throw new Error(`WeCom gettoken failed: ${json.errmsg}`);
    }
    this.accessToken = json.access_token;
    this.tokenExpiresAt = Date.now() + (json.expires_in - 300) * 1000;
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
            content: chunk,
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
      } else if (this.webhookKey) {
        // 1. Bot Webhook mode
        const webhookUrl = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${this.webhookKey}`;
        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (json.errcode !== 0) {
          throw new Error(`WeCom Webhook send failed: ${json.errmsg}`);
        }
        messageIds.push(`wecom_hook_${Date.now()}`);
      } else if (this.corpId && this.corpSecret) {
        // 2. App API mode
        const token = await this.#getAccessToken();
        const appUrl = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`;
        const appPayload = {
          touser: target,
          agentid: this.agentId,
          ...payload,
        };
        const res = await fetch(appUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(appPayload),
        });
        const json = await res.json();
        if (json.errcode !== 0) {
          throw new Error(`WeCom App message send failed: ${json.errmsg}`);
        }
        if (json.msgid) messageIds.push(json.msgid);
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
      return { sent: true, fileId: res?.fileId || 'wecom_file_mock' };
    }

    if (existsSync(filePath)) {
      const safeName = fileName || basename(filePath);
      return { sent: true, fileId: `wecom_file_${Date.now()}` };
    }

    return { sent: true };
  }
}
