import test from 'node:test';
import assert from 'node:assert/strict';
import { CliAgentRunner } from '../src/agent-drivers/cli-runner.js';

test('CliAgentRunner executes mock agent script and streams standardized events', async () => {
  // A tiny node script acting as a mock stream-json agent
  const mockScript = [
    'console.log(JSON.stringify({ type: "system", session_id: "sess_test_100", cwd: process.cwd() }));',
    'console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "thinking", thinking: "Analyzing..." }] } }));',
    'console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Task completed successfully." }] } }));',
    'console.log(JSON.stringify({ type: "result", session_id: "sess_test_100", usage: { input_tokens: 10, output_tokens: 5 } }));',
  ].join('\n');

  const runner = new CliAgentRunner({
    binary: process.execPath, // node
    agentType: 'claude',
  });

  const events = [];
  const run = runner.execute({
    prompt: 'Hello agent',
    cwd: process.cwd(),
    sessionId: null,
    customArgs: ['-e', mockScript],
  });

  for await (const evt of run.events) {
    events.push(evt);
  }

  assert.ok(events.length >= 3);
  const systemEvt = events.find((e) => e.type === 'system');
  assert.equal(systemEvt.sessionId, 'sess_test_100');

  const thinkingEvt = events.find((e) => e.type === 'thinking');
  assert.equal(thinkingEvt.delta, 'Analyzing...');

  const textEvt = events.find((e) => e.type === 'text');
  assert.equal(textEvt.delta, 'Task completed successfully.');

  const doneEvt = events.find((e) => e.type === 'done');
  assert.equal(doneEvt.sessionId, 'sess_test_100');
  assert.equal(doneEvt.terminationReason, 'normal');
});

test('CliAgentRunner supports abort / interrupt', async () => {
  // A mock script that sleeps for 5 seconds
  const sleepScript = 'setTimeout(() => {}, 5000);';

  const runner = new CliAgentRunner({
    binary: process.execPath,
    agentType: 'generic',
  });

  const run = runner.execute({
    prompt: 'Sleep',
    cwd: process.cwd(),
    customArgs: ['-e', sleepScript],
  });

  // Stop after 50ms
  setTimeout(() => run.interrupt(), 50);

  const events = [];
  for await (const evt of run.events) {
    events.push(evt);
  }

  const doneOrErr = events.find((e) => e.type === 'done' || e.type === 'error');
  assert.ok(doneOrErr);
  assert.equal(doneOrErr.terminationReason, 'interrupted');
});
