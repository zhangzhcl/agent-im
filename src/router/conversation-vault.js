import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Vault for managing persistent conversation identities, working directories,
 * agent session IDs, and recent conversation history.
 */
export class ConversationVault {
  constructor({ stateDir }) {
    this.stateDir = stateDir;
    this.filePath = join(stateDir, 'conversations.json');
    this.conversations = new Map();
    this.keyToId = new Map(); // `${channel}:${chatKey}` -> conversationId

    this.#initStorage();
  }

  #initStorage() {
    if (this.stateDir && !existsSync(this.stateDir)) {
      mkdirSync(this.stateDir, { recursive: true });
    }
    if (this.filePath && existsSync(this.filePath)) {
      try {
        const raw = JSON.parse(readFileSync(this.filePath, 'utf8'));
        if (Array.isArray(raw)) {
          for (const item of raw) {
            this.conversations.set(item.conversationId, item);
            this.keyToId.set(`${item.channel}:${item.chatKey}`, item.conversationId);
          }
        }
      } catch {
        // Fall back to empty map if file corrupt
      }
    }
  }

  #save() {
    if (!this.filePath) return;
    try {
      const data = [...this.conversations.values()];
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch {
      // Ignore disk write failure in testing / memory mode
    }
  }

  getOrCreate(channel, chatKey, defaultCwd = process.cwd()) {
    const lookupKey = `${channel}:${chatKey}`;
    const existingId = this.keyToId.get(lookupKey);
    if (existingId && this.conversations.has(existingId)) {
      return this.conversations.get(existingId);
    }

    const conversationId = `conv_${channel}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const record = {
      conversationId,
      channel,
      chatKey,
      workingDirectory: defaultCwd,
      agentSessionId: null,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      history: [],
    };

    this.conversations.set(conversationId, record);
    this.keyToId.set(lookupKey, conversationId);
    this.#save();
    return record;
  }

  getById(conversationId) {
    return this.conversations.get(conversationId) ?? null;
  }

  findByChannelAndKey(channel, chatKey) {
    const id = this.keyToId.get(`${channel}:${chatKey}`);
    return id ? this.getById(id) : null;
  }

  updateAgentSessionId(conversationId, agentSessionId) {
    const record = this.getById(conversationId);
    if (!record) return false;
    record.agentSessionId = agentSessionId;
    record.lastActiveAt = Date.now();
    this.#save();
    return true;
  }

  resetSession(conversationId) {
    const record = this.getById(conversationId);
    if (!record) return false;
    record.agentSessionId = null;
    record.lastActiveAt = Date.now();
    this.#save();
    return true;
  }

  setWorkingDirectory(conversationId, workingDirectory) {
    const record = this.getById(conversationId);
    if (!record) return false;
    record.workingDirectory = workingDirectory;
    record.lastActiveAt = Date.now();
    this.#save();
    return true;
  }

  recordHistory(conversationId, userText, assistantText) {
    const record = this.getById(conversationId);
    if (!record) return;
    record.history.push({
      user: userText,
      assistant: assistantText,
      timestamp: Date.now(),
    });
    // Keep max 5 recent items per specifications
    if (record.history.length > 5) {
      record.history = record.history.slice(-5);
    }
    record.lastActiveAt = Date.now();
    this.#save();
  }

  getHistory(conversationId, count = 3) {
    const record = this.getById(conversationId);
    if (!record || !record.history) return [];
    const safeCount = Math.min(Math.max(1, count), 5);
    return record.history.slice(-safeCount);
  }
}
