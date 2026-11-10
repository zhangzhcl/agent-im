import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig, GatewayConfigError } from '../src/config.js';

test('resolveConfig provides secure defaults when empty config provided', () => {
  const config = resolveConfig({});
  assert.equal(config.server.host, '127.0.0.1');
  assert.equal(config.server.port, 8080);
  assert.equal(config.limits.maxBodyBytes, 1024 * 1024);
  assert.equal(config.limits.maxConcurrentProcesses, 10);
  assert.equal(config.limits.maxBatchQueueSize, 10);
  assert.equal(config.agent.mode, 'cli');
});

test('resolveConfig merges user-defined options accurately', () => {
  const config = resolveConfig({
    server: { port: 9000 },
    agent: {
      mode: 'webhook',
      webhookUrl: 'http://localhost:5000/agent-hook',
    },
    channels: {
      feishu: { appId: 'cli_test', appSecret: 'sec_test' },
    },
  });

  assert.equal(config.server.port, 9000);
  assert.equal(config.server.host, '127.0.0.1');
  assert.equal(config.agent.mode, 'webhook');
  assert.equal(config.agent.webhookUrl, 'http://localhost:5000/agent-hook');
  assert.equal(config.channels.feishu.appId, 'cli_test');
});

test('resolveConfig validates invalid agent mode', () => {
  assert.throws(
    () => resolveConfig({ agent: { mode: 'invalid_mode' } }),
    GatewayConfigError
  );
});

test('resolveConfig validates invalid port numbers', () => {
  assert.throws(
    () => resolveConfig({ server: { port: -1 } }),
    GatewayConfigError
  );
  assert.throws(
    () => resolveConfig({ server: { port: 70000 } }),
    GatewayConfigError
  );
});
