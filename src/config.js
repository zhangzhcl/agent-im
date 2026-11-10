import { homedir } from 'node:os';
import { join } from 'node:path';

export class GatewayConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GatewayConfigError';
  }
}

const SUPPORTED_AGENT_MODES = new Set(['cli', 'mcp', 'webhook']);

export function resolveConfig(raw = {}) {
  if (typeof raw !== 'object' || raw === null) {
    throw new GatewayConfigError('Configuration must be a non-null object');
  }

  const server = {
    host: raw.server?.host ?? '127.0.0.1',
    port: raw.server?.port ?? 8080,
  };

  if (typeof server.port !== 'number' || server.port < 1 || server.port > 65535) {
    throw new GatewayConfigError(`Invalid port number: ${server.port}`);
  }

  const agentMode = raw.agent?.mode ?? 'cli';
  if (!SUPPORTED_AGENT_MODES.has(agentMode)) {
    throw new GatewayConfigError(`Unsupported agent mode: ${agentMode}. Supported: ${[...SUPPORTED_AGENT_MODES].join(', ')}`);
  }

  const agent = {
    mode: agentMode,
    agentType: raw.agent?.agentType ?? null,
    binary: raw.agent?.binary ?? 'claude',
    model: raw.agent?.model ?? null,
    permissionLevel: raw.agent?.permissionLevel ?? 'dontAsk',
    webhookUrl: raw.agent?.webhookUrl ?? null,
    timeoutMs: raw.agent?.timeoutMs ?? 180000,
  };

  const security = {
    allowlist: Array.isArray(raw.security?.allowlist) ? raw.security.allowlist : null,
  };

  const defaultStorage = join(homedir(), '.omni-im-gateway');
  const storage = {
    stateDir: raw.storage?.stateDir ?? defaultStorage,
    mediaCacheDir: raw.storage?.mediaCacheDir ?? join(defaultStorage, 'media'),
  };

  const limits = {
    maxBodyBytes: raw.limits?.maxBodyBytes ?? 1024 * 1024, // 1 MiB
    maxConcurrentProcesses: raw.limits?.maxConcurrentProcesses ?? 10,
    maxBatchQueueSize: raw.limits?.maxBatchQueueSize ?? 10,
    channelTextBudget: {
      wechat: 1800,
      feishu: 4000,
      dingtalk: 4000,
      wecom: 4000,
      qq: 3000,
      ...(raw.limits?.channelTextBudget ?? {}),
    },
  };

  const channels = {
    feishu: raw.channels?.feishu ?? null,
    wechat: raw.channels?.wechat ?? null,
    dingtalk: raw.channels?.dingtalk ?? null,
    wecom: raw.channels?.wecom ?? null,
    qq: raw.channels?.qq ?? null,
  };

  return {
    server,
    agent,
    storage,
    limits,
    security,
    channels,
  };
}
