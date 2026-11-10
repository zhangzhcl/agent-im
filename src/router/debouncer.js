/**
 * Message debouncer and per-conversation serial task execution queue.
 */
export class MessageDebouncerQueue {
  constructor({ debounceMs = 1500, onExecute }) {
    this.debounceMs = debounceMs;
    this.onExecute = onExecute;

    // Per conversation buffers and execution locks
    this.buffers = new Map(); // conversationId -> { timer, messages: [] }
    this.queues = new Map();  // conversationId -> Array<combinedMessage>
    this.running = new Set(); // Set of active conversationIds
  }

  push(conversationId, message) {
    let entry = this.buffers.get(conversationId);
    if (!entry) {
      entry = { timer: null, messages: [] };
      this.buffers.set(conversationId, entry);
    }

    entry.messages.push(message);

    if (entry.timer) {
      clearTimeout(entry.timer);
    }

    entry.timer = setTimeout(() => {
      this.#flushBuffer(conversationId);
    }, this.debounceMs);
  }

  #flushBuffer(conversationId) {
    const entry = this.buffers.get(conversationId);
    if (!entry || entry.messages.length === 0) return;

    this.buffers.delete(conversationId);

    // Combine texts
    const texts = entry.messages.map((m) => m.text).filter(Boolean);
    const attachments = entry.messages.flatMap((m) => m.attachments || []);

    const combinedMessage = {
      text: texts.join('\n'),
      attachments,
      originalMessages: entry.messages,
    };

    let q = this.queues.get(conversationId);
    if (!q) {
      q = [];
      this.queues.set(conversationId, q);
    }
    q.push(combinedMessage);

    this.#pump(conversationId);
  }

  async #pump(conversationId) {
    if (this.running.has(conversationId)) return;

    const q = this.queues.get(conversationId);
    if (!q || q.length === 0) {
      this.queues.delete(conversationId);
      return;
    }

    const nextTask = q.shift();
    this.running.add(conversationId);

    try {
      if (typeof this.onExecute === 'function') {
        await this.onExecute(conversationId, nextTask);
      }
    } catch (err) {
      // Allow execution loop to continue despite errors
    } finally {
      this.running.delete(conversationId);
      this.#pump(conversationId);
    }
  }

  interrupt(conversationId) {
    const entry = this.buffers.get(conversationId);
    if (entry?.timer) {
      clearTimeout(entry.timer);
      this.buffers.delete(conversationId);
    }
    this.queues.delete(conversationId);
  }
}
