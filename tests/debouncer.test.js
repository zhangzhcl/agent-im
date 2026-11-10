import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageDebouncerQueue } from '../src/router/debouncer.js';

test('MessageDebouncerQueue combines rapidly sent messages within debounce window', async () => {
  const dispatched = [];
  const queue = new MessageDebouncerQueue({
    debounceMs: 50,
    onExecute: async (conversationId, combinedMessage) => {
      dispatched.push({ conversationId, text: combinedMessage.text });
    },
  });

  // Push 3 messages within 30ms for the same conversation
  queue.push('conv_1', { text: 'Hello' });
  await new Promise((r) => setTimeout(r, 10));
  queue.push('conv_1', { text: 'world' });
  await new Promise((r) => setTimeout(r, 10));
  queue.push('conv_1', { text: 'how are you?' });

  // Wait for debounce to settle
  await new Promise((r) => setTimeout(r, 100));

  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].conversationId, 'conv_1');
  assert.equal(dispatched[0].text, 'Hello\nworld\nhow are you?');
});

test('MessageDebouncerQueue serializes execution per conversation', async () => {
  const executionOrder = [];
  const queue = new MessageDebouncerQueue({
    debounceMs: 20,
    onExecute: async (conversationId, message) => {
      executionOrder.push(`start:${message.text}`);
      await new Promise((r) => setTimeout(r, 50));
      executionOrder.push(`end:${message.text}`);
    },
  });

  // Push first message
  queue.push('conv_1', { text: 'Task 1' });
  await new Promise((r) => setTimeout(r, 30));

  // Push second message while Task 1 is still executing
  queue.push('conv_1', { text: 'Task 2' });

  // Wait for both to finish
  await new Promise((r) => setTimeout(r, 150));

  assert.deepEqual(executionOrder, [
    'start:Task 1',
    'end:Task 1',
    'start:Task 2',
    'end:Task 2',
  ]);
});
