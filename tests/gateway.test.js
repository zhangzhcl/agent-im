import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OmniGateway } from '../src/gateway.js';

test('OmniGateway dispatches inbound messages to mock agent and delivers reply to channel', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'gateway-test-'));

  const deliveredMessages = [];
  const deliveredMedia = [];

  // A mock script that acts as an agent and outputs stream-json
  const mockAgentScript = [
    'console.log(JSON.stringify({ type: "system", session_id: "agent_sess_42" }));',
    'console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Answer: 42" }] } }));',
    'console.log(JSON.stringify({ type: "result", session_id: "agent_sess_42" }));',
  ].join('\n');

  const gateway = new OmniGateway({
    config: {
      storage: { stateDir: tempDir, mediaCacheDir: join(tempDir, 'media') },
      agent: {
        mode: 'cli',
        binary: process.execPath, // node
      },
    },
    // Mock channel sender function
    mockSenders: {
      feishu: async (target, payload) => {
        deliveredMessages.push({ target, payload });
        return { messageId: 'fs_mock_1' };
      },
    },
  });

  // Inject custom agent runner args to execute mock script
  gateway.customAgentArgs = ['-e', mockAgentScript];

  await gateway.start();

  // Simulate an inbound Feishu user message
  await gateway.handleInbound({
    channel: 'feishu',
    chatKey: 'oc_test_group',
    chatType: 'direct',
    senderId: 'user_alice',
    senderName: 'Alice',
    text: 'What is the answer?',
  });

  // Allow debouncer and async execution to complete
  await new Promise((resolve) => setTimeout(resolve, 200));

  assert.ok(deliveredMessages.length >= 1, 'Should deliver reply to feishu');
  const delivered = deliveredMessages[0];
  assert.equal(delivered.target, 'oc_test_group');
  assert.match(JSON.stringify(delivered.payload), /Answer: 42/);

  // Check vault state updated with session id
  const conv = gateway.vault.findByChannelAndKey('feishu', 'oc_test_group');
  assert.equal(conv.agentSessionId, 'agent_sess_42');

  // Verify history was recorded
  const history = gateway.vault.getHistory(conv.conversationId);
  assert.equal(history.length, 1);
  assert.equal(history[0].user, 'What is the answer?');
  assert.equal(history[0].assistant, 'Answer: 42');

  await gateway.stop();
  rmSync(tempDir, { recursive: true, force: true });
});

test('OmniGateway handles slash command /new without invoking agent', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'gateway-cmd-test-'));
  const deliveredMessages = [];

  const gateway = new OmniGateway({
    config: {
      storage: { stateDir: tempDir, mediaCacheDir: join(tempDir, 'media') },
      agent: { mode: 'cli', binary: process.execPath },
    },
    mockSenders: {
      wechat: async (target, chunk) => {
        deliveredMessages.push({ target, chunk });
        return { messageId: 'wx_cmd_1' };
      },
    },
  });

  await gateway.start();

  // Seed conversation with existing agent session
  const conv = gateway.vault.getOrCreate('wechat', 'user_bob', tempDir);
  gateway.vault.updateAgentSessionId(conv.conversationId, 'old_session');

  // Send /new
  await gateway.handleInbound({
    channel: 'wechat',
    chatKey: 'user_bob',
    chatType: 'direct',
    senderId: 'user_bob',
    senderName: 'Bob',
    text: '/new',
  });

  assert.equal(deliveredMessages.length, 1);
  assert.match(deliveredMessages[0].chunk, /会话已重置/);
  assert.equal(gateway.vault.getById(conv.conversationId).agentSessionId, null);

  await gateway.stop();
  rmSync(tempDir, { recursive: true, force: true });
});

test('OmniGateway delivers outbound file attachments', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'gateway-media-test-'));
  const deliveredFiles = [];

  const gateway = new OmniGateway({
    config: {
      storage: { stateDir: tempDir, mediaCacheDir: join(tempDir, 'media') },
      agent: { mode: 'cli', binary: process.execPath },
    },
    mockSenders: {
      dingtalk: async (target, payload) => {
        if (payload.msgtype === 'file') deliveredFiles.push({ target, payload });
        return { messageId: 'dt_file_1' };
      },
    },
  });

  await gateway.start();

  const conv = gateway.vault.getOrCreate('dingtalk', 'user_charlie', tempDir);
  const sampleFile = join(tempDir, 'chart.png');
  writeFileSync(sampleFile, 'fake-png-data');

  const result = await gateway.deliverOutbound({
    conversationId: conv.conversationId,
    text: 'Here is your chart:',
    files: [sampleFile],
    format: 'plain',
  });

  assert.equal(result.sent, true);
  assert.equal(deliveredFiles.length, 1);
  assert.equal(deliveredFiles[0].target, 'user_charlie');
  assert.equal(deliveredFiles[0].payload.fileName, 'chart.png');

  await gateway.stop();
  rmSync(tempDir, { recursive: true, force: true });
});
