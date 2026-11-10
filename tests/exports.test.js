import test from 'node:test';
import assert from 'node:assert/strict';
import * as omni from '../index.js';

test('index.js exports all primary classes, protocols and utilities', () => {
  assert.equal(typeof omni.OmniGateway, 'function');
  assert.equal(typeof omni.resolveConfig, 'function');
  assert.equal(typeof omni.ConversationVault, 'function');
  assert.equal(typeof omni.MessageDebouncerQueue, 'function');
  assert.equal(typeof omni.CommandDispatcher, 'function');
  assert.equal(typeof omni.MediaHub, 'function');
  assert.equal(typeof omni.FeishuChannel, 'function');
  assert.equal(typeof omni.WeChatChannel, 'function');
  assert.equal(typeof omni.DingTalkChannel, 'function');
  assert.equal(typeof omni.WeComChannel, 'function');
  assert.equal(typeof omni.QqChannel, 'function');
  assert.equal(typeof omni.CliAgentRunner, 'function');
  assert.equal(typeof omni.McpAgentServer, 'function');
  assert.equal(typeof omni.WebhookAgentServer, 'function');
  assert.equal(typeof omni.splitTextWithCodeFences, 'function');
  assert.equal(typeof omni.stripMarkdownToPlain, 'function');
  assert.equal(typeof omni.createInboundMessageEvent, 'function');
  assert.equal(typeof omni.createOutboundDeliveryPayload, 'function');
});
