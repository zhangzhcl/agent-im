import { createServer } from 'node:http';

/**
 * HTTP Webhook & REST Server for cloud/local agents (Dify, FastGPT, Python).
 */
export class WebhookAgentServer {
  constructor({
    host = '127.0.0.1',
    port = 8080,
    maxBodyBytes = 1024 * 1024, // 1 MiB
    onDeliverMessage,
  } = {}) {
    this.host = host;
    this.port = port;
    this.maxBodyBytes = maxBodyBytes;
    this.onDeliverMessage = onDeliverMessage;
    this.server = null;
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.#handleRequest(req, res));
      this.server.on('error', reject);
      this.server.listen(this.port, this.host, () => {
        resolve();
      });
    });
  }

  address() {
    return this.server?.address() ?? null;
  }

  async stop() {
    if (!this.server) return;
    return new Promise((resolve) => {
      this.server.close(() => resolve());
      this.server = null;
    });
  }

  async #handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

    // CORS headers for local tools
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/v1/messages/send') {
      let bodyLength = 0;
      const chunks = [];
      let tooLarge = false;

      req.on('data', (chunk) => {
        if (tooLarge) return;
        bodyLength += chunk.length;
        if (bodyLength > this.maxBodyBytes) {
          tooLarge = true;
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Payload Too Large', maxBytes: this.maxBodyBytes }));
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', async () => {
        if (tooLarge) return;

        let parsed = null;
        try {
          const bodyStr = Buffer.concat(chunks).toString('utf8');
          parsed = JSON.parse(bodyStr);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
          return;
        }

        if (!parsed || !parsed.conversationId || typeof parsed.text !== 'string' || !parsed.text.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing required conversationId or text' }));
          return;
        }

        try {
          if (typeof this.onDeliverMessage === 'function') {
            const result = await this.onDeliverMessage(parsed);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result || { sent: true }));
          } else {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Delivery handler unavailable' }));
          }
        } catch (err) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err?.message || 'Outbound delivery failed' }));
        }
      });
      return;
    }

    // 404 Not Found
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
  }

  /**
   * Forward an inbound IM event to a remote agent Webhook endpoint.
   */
  async forwardToAgentWebhook(webhookUrl, eventPayload, timeoutMs = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventPayload),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Webhook returned status ${response.status}`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return await response.json();
      }
      return await response.text();
    } finally {
      clearTimeout(timer);
    }
  }
}
