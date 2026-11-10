import test from 'node:test';
import assert from 'node:assert/strict';
import { McpAgentServer } from '../src/agent-drivers/mcp-server.js';

test('McpAgentServer handles initialize handshake, ping and notifications', async () => {
  const mcp = new McpAgentServer();

  // 1. initialize
  const initRes = await mcp.handleJsonRpc({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'claude-code', version: '2.1.318' },
    },
  });

  assert.equal(initRes.jsonrpc, '2.0');
  assert.equal(initRes.id, 1);
  assert.equal(initRes.result?.serverInfo?.name, 'omni-im-gateway');
  assert.ok(initRes.result?.capabilities?.tools);

  // 2. notifications/initialized (should return null - no response frame)
  const notifRes = await mcp.handleJsonRpc({
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  });
  assert.equal(notifRes, null);

  // 3. ping
  const pingRes = await mcp.handleJsonRpc({
    jsonrpc: '2.0',
    id: 2,
    method: 'ping',
  });
  assert.equal(pingRes.id, 2);
  assert.deepEqual(pingRes.result, {});
});

test('McpAgentServer advertises tools via tools/list', async () => {
  const mcp = new McpAgentServer({
    onSendMessage: async () => ({ success: true, messageId: 'm1' }),
    onSendFile: async () => ({ success: true, fileId: 'f1' }),
    onGetHistory: async () => ({ messages: [] }),
  });

  const response = await mcp.handleJsonRpc({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {},
  });

  assert.equal(response.jsonrpc, '2.0');
  assert.equal(response.id, 1);
  assert.ok(response.result?.tools);

  const toolNames = response.result.tools.map((t) => t.name);
  assert.ok(toolNames.includes('send_im_message'));
  assert.ok(toolNames.includes('send_im_file'));
  assert.ok(toolNames.includes('get_im_history'));
});

test('McpAgentServer executes send_im_message via tools/call', async () => {
  let calledWith = null;
  const mcp = new McpAgentServer({
    onSendMessage: async (target, text, format) => {
      calledWith = { target, text, format };
      return { success: true, messageId: 'msg_999' };
    },
    onSendFile: async () => {},
    onGetHistory: async () => {},
  });

  const response = await mcp.handleJsonRpc({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'send_im_message',
      arguments: {
        target: 'feishu-dev',
        text: 'Build passed!',
        format: 'markdown',
      },
    },
  });

  assert.equal(response.id, 2);
  assert.deepEqual(calledWith, {
    target: 'feishu-dev',
    text: 'Build passed!',
    format: 'markdown',
  });
  assert.equal(response.result?.content?.[0]?.text, JSON.stringify({ success: true, messageId: 'msg_999' }));
});
