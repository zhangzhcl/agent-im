import test from 'node:test';
import assert from 'node:assert/strict';
import { WebhookAgentServer } from '../src/agent-drivers/webhook-server.js';

test('WebhookAgentServer handles /health and /api/v1/messages/send', async () => {
  let outboundDelivery = null;
  const server = new WebhookAgentServer({
    port: 0, // ephemeral port
    host: '127.0.0.1',
    onDeliverMessage: async (payload) => {
      outboundDelivery = payload;
      return { sent: true, messageId: 'msg_webhook_1' };
    },
  });

  await server.start();
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Health check
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = await healthRes.json();
    assert.equal(healthJson.status, 'ok');

    // 2. Outbound message sending
    const sendRes = await fetch(`${baseUrl}/api/v1/messages/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: 'conv_feishu_123',
        text: 'Report completed',
        format: 'markdown',
        files: ['/tmp/report.pdf'],
      }),
    });

    assert.equal(sendRes.status, 200);
    const sendJson = await sendRes.json();
    assert.equal(sendJson.sent, true);
    assert.equal(sendJson.messageId, 'msg_webhook_1');

    assert.deepEqual(outboundDelivery, {
      conversationId: 'conv_feishu_123',
      text: 'Report completed',
      format: 'markdown',
      files: ['/tmp/report.pdf'],
    });

    // 3. Bad request on missing fields
    const badRes = await fetch(`${baseUrl}/api/v1/messages/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(badRes.status, 400);

    // 4. Payload too large (over 1 MiB)
    const bigBody = 'x'.repeat(1024 * 1024 + 10);
    const largeRes = await fetch(`${baseUrl}/api/v1/messages/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: bigBody }),
    });
    assert.equal(largeRes.status, 413);
  } finally {
    await server.stop();
  }
});
