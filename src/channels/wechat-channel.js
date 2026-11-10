import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { ChannelAdapter } from './channel-interface.js';
import { splitTextWithCodeFences, stripMarkdownToPlain } from '../protocols/formatter.js';

/**
 * WeChat (微信) channel adapter with 1,800 character budget,
 * code-fence preservation, markdown-to-plain adaptation, and bridge connectivity.
 */
export class WeChatChannel extends ChannelAdapter {
  constructor(options = {}) {
    super('wechat', options);
    this.bridgeUrl = options.bridgeUrl || process.env.WECHAT_BRIDGE_URL || null;
    this.budget = options.budget ?? 1800;
    this.senderFn = options.senderFn ?? null;
  }

  async start() {
    this.connected = true;
    return true;
  }

  async stop() {
    this.connected = false;
    return true;
  }

  async sendText(target, text, format = 'plain') {
    // WeChat displays best with plain text while protecting code fences and URLs
    const preparedText = format === 'markdown' ? stripMarkdownToPlain(text) : text;
    const chunks = splitTextWithCodeFences(preparedText, this.budget);
    const messageIds = [];

    for (const chunk of chunks) {
      if (typeof this.senderFn === 'function') {
        const res = await this.senderFn(target, chunk);
        if (res?.messageId) messageIds.push(res.messageId);
      } else if (this.bridgeUrl) {
        try {
          const res = await fetch(`${this.bridgeUrl}/api/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              toUserId: target,
              content: chunk,
            }),
          });
          const json = await res.json();
          if (json.messageId) messageIds.push(json.messageId);
        } catch (err) {
          throw new Error(`WeChat Bridge send failed: ${err.message}`);
        }
      }
    }

    return { sent: true, messageIds };
  }

  async sendMedia(target, filePath, fileName) {
    if (typeof this.senderFn === 'function') {
      const res = await this.senderFn(target, {
        type: 'file',
        filePath,
        fileName,
      });
      return { sent: true, fileId: res?.fileId || 'wx_file_mock' };
    }

    if (this.bridgeUrl && existsSync(filePath)) {
      try {
        const safeName = fileName || basename(filePath);
        const res = await fetch(`${this.bridgeUrl}/api/send-file`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            toUserId: target,
            filePath,
            fileName: safeName,
          }),
        });
        const json = await res.json();
        return { sent: true, fileId: json.fileId || `wx_file_${Date.now()}` };
      } catch (err) {
        throw new Error(`WeChat Bridge file send failed: ${err.message}`);
      }
    }

    return { sent: true };
  }
}
