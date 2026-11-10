import { EventEmitter } from 'node:events';

/**
 * Base abstract contract for all IM channel adapters.
 */
export class ChannelAdapter extends EventEmitter {
  constructor(name, options = {}) {
    super();
    this.name = name;
    this.options = options;
    this.connected = false;
  }

  async start() {
    this.connected = true;
    return true;
  }

  async stop() {
    this.connected = false;
    return true;
  }

  isConnected() {
    return this.connected;
  }

  /**
   * Send a text or formatted message to a target chat.
   * @param {string} target - The chat/user ID.
   * @param {string} text - Message content.
   * @param {'plain'|'markdown'} format - Content format.
   * @returns {Promise<{ sent: boolean, messageId?: string }>}
   */
  async sendText(target, text, format = 'plain') {
    throw new Error('sendText() must be implemented by channel adapter');
  }

  /**
   * Send an attachment (file, image, document) to a target chat.
   * @param {string} target - The chat/user ID.
   * @param {string} filePath - Local path to the file.
   * @param {string} [fileName] - Optional display name.
   * @returns {Promise<{ sent: boolean, fileId?: string }>}
   */
  async sendMedia(target, filePath, fileName) {
    throw new Error('sendMedia() must be implemented by channel adapter');
  }

  /**
   * Helper to emit normalized inbound message event.
   */
  dispatchInbound(messageEvent) {
    this.emit('message', messageEvent);
  }
}
