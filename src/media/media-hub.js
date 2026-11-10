import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export class MediaHubError extends Error {
  constructor(message, code = 'MEDIA_ERROR') {
    super(message);
    this.name = 'MediaHubError';
    this.code = code;
  }
}

/**
 * MediaHub manages snapshotting, staging, validation, and storage of files and images.
 */
export class MediaHub {
  constructor({ cacheDir, maxSizeBytes = 50 * 1024 * 1024 }) {
    this.cacheDir = cacheDir;
    this.maxSizeBytes = maxSizeBytes;
    this.stagedRecords = new Map(); // fileId -> record

    if (this.cacheDir && !existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  async stageFile(targetPath, baseDir = process.cwd()) {
    if (!targetPath || typeof targetPath !== 'string') {
      throw new MediaHubError('Invalid target path', 'INVALID_PATH');
    }

    const fullPath = resolve(baseDir, targetPath);
    if (!existsSync(fullPath)) {
      throw new MediaHubError(`File not found: ${targetPath}`, 'NOT_FOUND');
    }

    const stat = statSync(fullPath);
    if (!stat.isFile()) {
      throw new MediaHubError(`Path is not a regular file: ${targetPath}`, 'NOT_A_FILE');
    }

    if (stat.size > this.maxSizeBytes) {
      throw new MediaHubError(
        `File size ${stat.size} bytes exceeds limit of ${this.maxSizeBytes} bytes`,
        'FILE_TOO_LARGE'
      );
    }

    const rawBuffer = readFileSync(fullPath);
    const digest = createHash('sha256').update(rawBuffer).digest('hex');

    const fileId = `art_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const originalName = basename(fullPath);
    const safeName = originalName.replace(/[\u0000-\u001f\u007f]/g, '').trim() || 'attachment.bin';

    const stagedFileName = `${fileId}_${safeName}`;
    const stagedPath = join(this.cacheDir, stagedFileName);

    copyFileSync(fullPath, stagedPath);

    const record = {
      fileId,
      fileName: safeName,
      fileSize: stat.size,
      digest,
      stagedPath,
      createdAt: Date.now(),
    };

    this.stagedRecords.set(fileId, record);
    return record;
  }

  async readStaged(fileId) {
    const record = this.stagedRecords.get(fileId);
    if (!record || !existsSync(record.stagedPath)) {
      throw new MediaHubError(`Staged artifact not found: ${fileId}`, 'NOT_FOUND');
    }
    return readFileSync(record.stagedPath);
  }

  getRecord(fileId) {
    return this.stagedRecords.get(fileId) ?? null;
  }

  cleanup(fileId) {
    const record = this.stagedRecords.get(fileId);
    if (record) {
      this.stagedRecords.delete(fileId);
      if (existsSync(record.stagedPath)) {
        try {
          rmSync(record.stagedPath, { force: true });
        } catch {
          // Ignore removal error
        }
      }
    }
  }
}
