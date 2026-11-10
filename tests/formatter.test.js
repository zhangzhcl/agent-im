import test from 'node:test';
import assert from 'node:assert/strict';
import { splitTextWithCodeFences, stripMarkdownToPlain } from '../src/protocols/formatter.js';

test('splitTextWithCodeFences returns single chunk when within budget', () => {
  const input = 'Hello world, this is a short test message.';
  const chunks = splitTextWithCodeFences(input, 100);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0], input);
});

test('splitTextWithCodeFences splits at paragraphs when exceeding budget', () => {
  const p1 = 'Paragraph 1: ' + 'A'.repeat(50);
  const p2 = 'Paragraph 2: ' + 'B'.repeat(50);
  const text = `${p1}\n\n${p2}`;
  const chunks = splitTextWithCodeFences(text, 70);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].trim(), p1);
  assert.equal(chunks[1].trim(), p2);
});

test('splitTextWithCodeFences preserves and completes code fences across chunks', () => {
  const codeLines = [
    '```javascript',
    'function calculateTotal(items) {',
    '  let total = 0;',
    '  for (const item of items) {',
    '    total += item.price * item.quantity;',
    '  }',
    '  return total;',
    '}',
    '```',
  ].join('\n');

  const before = 'Here is the sales calculation function:\n\n';
  const after = '\n\nPlease review and test the implementation.';
  const fullText = before + codeLines + after;

  const maxChunk = 80;
  const chunks = splitTextWithCodeFences(fullText, maxChunk);

  assert.ok(chunks.length >= 2, `Expected multiple chunks, got ${chunks.length}`);

  // Check code fence balance in every chunk
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const fenceMatches = chunk.match(/```/g) || [];
    assert.equal(
      fenceMatches.length % 2,
      0,
      `Chunk index ${i} has unbalanced backticks (${fenceMatches.length}):\n${chunk}`
    );
  }

  // The second chunk should open with the same language fence if split inside
  const secondChunk = chunks[1];
  if (!secondChunk.startsWith('Please')) {
    assert.match(secondChunk, /^```javascript\n/);
  }
});

test('stripMarkdownToPlain removes formatting markers while keeping URLs and code content', () => {
  const md = '# Header Title\n\n**Bold text** and *italic text* with [Website](https://example.com).\n\n```python\nprint("hello")\n```';
  const plain = stripMarkdownToPlain(md);

  assert.doesNotMatch(plain, /# Header/);
  assert.doesNotMatch(plain, /\*\*Bold/);
  assert.match(plain, /Header Title/);
  assert.match(plain, /Bold text and italic text/);
  assert.match(plain, /Website \(https:\/\/example.com\)/);
  assert.match(plain, /print\("hello"\)/);
});
