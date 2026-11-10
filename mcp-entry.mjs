#!/usr/bin/env node

/**
 * Dedicated Model Context Protocol (MCP) entry point for Claude Code, Cursor, and Claude Desktop.
 * Exposes outbound tools (send_im_message, send_im_file, get_im_history) without opening
 * inbound WebSocket long connections (which are owned by the background daemon).
 *
 * Config resolution: OMNI_IM_GATEWAY_CONFIG env var first, then ./config.json relative to cwd.
 * Without a config the gateway falls back to built-in defaults and channel credentials
 * stay unavailable, so prefer setting the env var in the MCP client's launch config.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { OmniGateway } from './src/gateway.js';
import { McpAgentServer } from './src/agent-drivers/mcp-server.js';

const configPath = process.env.OMNI_IM_GATEWAY_CONFIG
  ? resolve(process.env.OMNI_IM_GATEWAY_CONFIG)
  : resolve('config.json');

let config = {};
if (existsSync(configPath)) {
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.error(`[mcp-entry] Failed to parse config file ${configPath}: ${err.message}`);
    process.exit(1);
  }
} else if (process.env.OMNI_IM_GATEWAY_CONFIG) {
  console.error(`[mcp-entry] Config file not found: ${configPath}`);
  process.exit(1);
}

const gateway = new OmniGateway({ config });
const mcp = new McpAgentServer({
  onSendMessage: (target, text, format) => gateway.deliverOutbound({ conversationId: target, text, format }),
  onSendFile: (target, filePath) => gateway.deliverOutbound({ conversationId: target, text: '', files: [filePath] }),
  onGetHistory: (target, limit) => ({ messages: gateway.vault.getHistory(target, limit) }),
});

mcp.startStdio();
