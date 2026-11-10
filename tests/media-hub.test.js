import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaHub, MediaHubError } from '../src/media/media-hub.js';

test('MediaHub stages and snapshots an existing file successfully', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'media-test-'));
  const hub = new MediaHub({ cacheDir: tempDir });

  const testFile = join(tempDir, 'report.txt');
  writeFileSync(testFile, 'Sales Report 2026: Total Revenue $1,000,000', 'utf8');

  const artifact = await hub.stageFile(testFile);
  assert.ok(artifact.fileId.startsWith('art_'));
  assert.equal(artifact.fileName, 'report.txt');
  assert.equal(artifact.fileSize, 43);
  assert.ok(artifact.digest);
  assert.ok(artifact.stagedPath);
  assert.notEqual(artifact.stagedPath, testFile);

  // Even if original is deleted or modified, staged file remains intact
  writeFileSync(testFile, 'Modified content', 'utf8');
  const buffer = await hub.readStaged(artifact.fileId);
  assert.equal(buffer.toString('utf8'), 'Sales Report 2026: Total Revenue $1,000,000');

  hub.cleanup(artifact.fileId);
  rmSync(tempDir, { recursive: true, force: true });
});

test('MediaHub rejects non-existent files or directories', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'media-test-err-'));
  const hub = new MediaHub({ cacheDir: tempDir });

  // Non-existent
  await assert.rejects(
    () => hub.stageFile(join(tempDir, 'missing.txt')),
    MediaHubError
  );

  // Directory instead of file
  await assert.rejects(
    () => hub.stageFile(tempDir),
    MediaHubError
  );

  rmSync(tempDir, { recursive: true, force: true });
});

test('MediaHub enforces maximum file size limit', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'media-test-limit-'));
  const hub = new MediaHub({ cacheDir: tempDir, maxSizeBytes: 100 });

  const bigFile = join(tempDir, 'big.bin');
  writeFileSync(bigFile, Buffer.alloc(200));

  await assert.rejects(
    () => hub.stageFile(bigFile),
    (err) => err instanceof MediaHubError && err.code === 'FILE_TOO_LARGE'
  );

  rmSync(tempDir, { recursive: true, force: true });
});
