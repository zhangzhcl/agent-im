#!/usr/bin/env node

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { OmniGateway } from '../src/gateway.js';
import { McpAgentServer } from '../src/agent-drivers/mcp-server.js';

function printHelp() {
  console.log(`
Omni IM Gateway - Universal Multi-Channel IM Agent Gateway

Usage:
  omni-im-gateway start [--config <path>]   Start the gateway server
  omni-im-gateway mcp [--config <path>]     Run in Model Context Protocol (MCP) stdio mode
  omni-im-gateway --help                    Show this help message

Config path resolution (for both start and mcp):
  --config <path>                           Explicit config file
  OMNI_IM_GATEWAY_CONFIG=<path>             Fallback via environment variable
  (none)                                     Empty default config

Channels:
  • Feishu (飞书)
  • WeChat (微信)
  • DingTalk (钉钉)
  • WeCom (企业微信)
  • QQ
`);
}

// start 与 mcp 共用同一套配置加载，保证 MCP 模式也能拿到渠道凭据与 stateDir
function loadConfigFromArgs(args) {
  let configPath = null;
  const configIdx = args.indexOf('--config');
  if (configIdx !== -1 && args[configIdx + 1]) {
    configPath = resolve(args[configIdx + 1]);
  } else if (process.env.OMNI_IM_GATEWAY_CONFIG) {
    configPath = resolve(process.env.OMNI_IM_GATEWAY_CONFIG);
  }

  if (!configPath) return {};
  if (!existsSync(configPath)) {
    console.error(`Config file not found: ${configPath}`);
    process.exit(1);
  }
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.error(`Failed to parse config file: ${err.message}`);
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'start';

  if (command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    process.exit(0);
  }

  if (command === 'mcp') {
    // In MCP mode, we do NOT start IM inbound long connections (WebSocket/Stream)
    // to prevent duplicate message consumption across multiple Claude Code sessions.
    // Outbound delivery and conversation state vault remain fully available.
    const gateway = new OmniGateway({ config: loadConfigFromArgs(args) });
    const mcp = new McpAgentServer({
      onSendMessage: (target, text, format) => gateway.deliverOutbound({ conversationId: target, text, format }),
      onSendFile: (target, filePath) => gateway.deliverOutbound({ conversationId: target, text: '', files: [filePath] }),
      onGetHistory: (target, limit) => ({ messages: gateway.vault.getHistory(target, limit) }),
    });
    mcp.startStdio();
    return;
  }

  if (command === 'start') {
    const gateway = new OmniGateway({ config: loadConfigFromArgs(args) });
    await gateway.start();
    console.log(`[OmniGateway] Gateway running. Host: ${gateway.config.server.host}, Port: ${gateway.config.server.port}`);
    console.log(`[OmniGateway] Agent mode: ${gateway.config.agent.mode}`);

    const shutdown = async () => {
      console.log('\n[OmniGateway] Shutting down...');
      await gateway.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

main().catch((err) => {
  console.error(`[OmniGateway] Fatal error: ${err.message}`);
  process.exit(1);
});
