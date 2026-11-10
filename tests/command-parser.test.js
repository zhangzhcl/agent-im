import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversationVault } from '../src/router/conversation-vault.js';
import { CommandDispatcher } from '../src/commands/command-parser.js';

test('CommandDispatcher handles /help, /status and /new commands', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'cmd-test-'));
  const vault = new ConversationVault({ stateDir: tempDir });
  const conv = vault.getOrCreate('feishu', 'chat_123', tempDir);
  vault.updateAgentSessionId(conv.conversationId, 'session_initial');

  const dispatcher = new CommandDispatcher({ vault });

  // /help
  const helpRes = await dispatcher.dispatch('/help', conv, { chatType: 'direct' });
  assert.equal(helpRes.handled, true);
  assert.match(helpRes.replyText, /\/new/);
  assert.match(helpRes.replyText, /\/status/);

  // /status
  const statusRes = await dispatcher.dispatch('/status', conv, { chatType: 'direct' });
  assert.equal(statusRes.handled, true);
  assert.match(statusRes.replyText, /session_initial/);
  assert.match(statusRes.replyText, /feishu/);

  // /new
  const newRes = await dispatcher.dispatch('/new', conv, { chatType: 'direct' });
  assert.equal(newRes.handled, true);
  assert.equal(vault.getById(conv.conversationId).agentSessionId, null);
  assert.match(newRes.replyText, /会话已重置/);

  rmSync(tempDir, { recursive: true, force: true });
});

test('CommandDispatcher handles /cd with directory validation', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'cmd-test-cd-'));
  const vault = new ConversationVault({ stateDir: tempDir });
  const conv = vault.getOrCreate('wecom', 'chat_cd', tempDir);
  const dispatcher = new CommandDispatcher({ vault });

  // Valid cd to existing directory
  const validRes = await dispatcher.dispatch(`/cd ${tempDir}`, conv, { chatType: 'direct' });
  assert.equal(validRes.handled, true);
  assert.equal(vault.getById(conv.conversationId).workingDirectory, tempDir);
  assert.match(validRes.replyText, /工作目录已切换/);

  // Invalid cd to non-existent directory
  const invalidRes = await dispatcher.dispatch('/cd /non_existent_dir_99999', conv, { chatType: 'direct' });
  assert.equal(invalidRes.handled, true);
  assert.match(invalidRes.replyText, /目录不存在/);

  rmSync(tempDir, { recursive: true, force: true });
});

test('CommandDispatcher handles /batch, /send, /cancel with direct chat enforcement', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'cmd-test-batch-'));
  const vault = new ConversationVault({ stateDir: tempDir });
  const conv = vault.getOrCreate('wechat', 'user_batch', tempDir);
  const dispatcher = new CommandDispatcher({ vault });

  // In group chat, /batch should be rejected
  const groupReject = await dispatcher.dispatch('/batch', conv, { chatType: 'group' });
  assert.equal(groupReject.handled, true);
  assert.match(groupReject.replyText, /仅限私聊/);

  // In direct chat, start /batch
  const batchStart = await dispatcher.dispatch('/batch', conv, { chatType: 'direct' });
  assert.equal(batchStart.handled, true);
  assert.match(batchStart.replyText, /已开启多条消息暂存/);

  // Ordinary messages should now be intercepted as batch items
  const collect1 = await dispatcher.dispatch('Message line 1', conv, { chatType: 'direct' });
  assert.equal(collect1.handled, true);
  assert.match(collect1.replyText, /已暂存 1\/10 条/);

  const collect2 = await dispatcher.dispatch('Message line 2', conv, { chatType: 'direct' });
  assert.equal(collect2.handled, true);
  assert.match(collect2.replyText, /已暂存 2\/10 条/);

  // /send releases the batch
  const sendRes = await dispatcher.dispatch('/send', conv, { chatType: 'direct' });
  assert.equal(sendRes.handled, true);
  assert.equal(sendRes.isBatchSubmission, true);
  assert.equal(sendRes.combinedText, 'Message line 1\nMessage line 2');

  rmSync(tempDir, { recursive: true, force: true });
});

test('CommandDispatcher handles /history with bounds check', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'cmd-test-hist-'));
  const vault = new ConversationVault({ stateDir: tempDir });
  const conv = vault.getOrCreate('dingtalk', 'user_hist', tempDir);
  vault.recordHistory(conv.conversationId, 'Hi', 'Hello there');
  const dispatcher = new CommandDispatcher({ vault });

  // In group chat, /history should be rejected
  const groupHist = await dispatcher.dispatch('/history', conv, { chatType: 'group' });
  assert.equal(groupHist.handled, true);
  assert.match(groupHist.replyText, /仅限私聊/);

  // In direct chat, /history 1
  const directHist = await dispatcher.dispatch('/history 1', conv, { chatType: 'direct' });
  assert.equal(directHist.handled, true);
  assert.match(directHist.replyText, /Hi/);
  assert.match(directHist.replyText, /Hello there/);

  rmSync(tempDir, { recursive: true, force: true });
});
