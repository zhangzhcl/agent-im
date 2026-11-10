import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversationVault } from '../src/router/conversation-vault.js';

test('ConversationVault manages conversation lifecycle and session continuity', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'vault-test-'));
  const vault = new ConversationVault({ stateDir: tempDir });

  // 1. Get or create conversation
  const conv1 = vault.getOrCreate('feishu', 'chat_group_123', '/projects/app-a');
  assert.ok(conv1.conversationId);
  assert.equal(conv1.channel, 'feishu');
  assert.equal(conv1.workingDirectory, '/projects/app-a');
  assert.equal(conv1.agentSessionId, null);

  // 2. Assign agent session id (resume continuity)
  vault.updateAgentSessionId(conv1.conversationId, 'claude_sess_abc123');
  const updated = vault.getById(conv1.conversationId);
  assert.equal(updated.agentSessionId, 'claude_sess_abc123');

  // 3. Reset session (/new) resets the agent session id but keeps conversation and directory
  vault.resetSession(conv1.conversationId);
  const afterReset = vault.getById(conv1.conversationId);
  assert.equal(afterReset.agentSessionId, null);
  assert.equal(afterReset.workingDirectory, '/projects/app-a');

  // 4. Update working directory (/cd)
  vault.setWorkingDirectory(conv1.conversationId, '/projects/app-b');
  assert.equal(vault.getById(conv1.conversationId).workingDirectory, '/projects/app-b');

  // 5. History recording and retrieval
  vault.recordHistory(conv1.conversationId, 'What is 1+1?', 'It is 2.');
  vault.recordHistory(conv1.conversationId, 'What is 2+2?', 'It is 4.');
  const hist = vault.getHistory(conv1.conversationId, 2);
  assert.equal(hist.length, 2);
  assert.equal(hist[0].user, 'What is 1+1?');
  assert.equal(hist[0].assistant, 'It is 2.');
  assert.equal(hist[1].user, 'What is 2+2?');
  assert.equal(hist[1].assistant, 'It is 4.');

  rmSync(tempDir, { recursive: true, force: true });
});

test('ConversationVault isolates different channels and chats', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'vault-test-iso-'));
  const vault = new ConversationVault({ stateDir: tempDir });

  const c1 = vault.getOrCreate('wechat', 'user_alice', '/dir1');
  const c2 = vault.getOrCreate('wechat', 'user_bob', '/dir2');
  const c3 = vault.getOrCreate('dingtalk', 'user_alice', '/dir3');

  assert.notEqual(c1.conversationId, c2.conversationId);
  assert.notEqual(c1.conversationId, c3.conversationId);

  vault.updateAgentSessionId(c1.conversationId, 'sess_alice');
  assert.equal(vault.getById(c1.conversationId).agentSessionId, 'sess_alice');
  assert.equal(vault.getById(c2.conversationId).agentSessionId, null);

  rmSync(tempDir, { recursive: true, force: true });
});
