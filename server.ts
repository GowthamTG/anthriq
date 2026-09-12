import { createServer, type ServerResponse, type IncomingMessage } from 'node:http';
import { resolve, join } from 'node:path';
import next from 'next';
import { Acquisition } from './core/acquisition.ts';
import { inspect } from './core/storage.ts';
import { listRecordings, recordingId } from './core/library.ts';
import { config, ConfigurationError } from './core/config.ts';

const dev = process.argv.includes('--dev');
const port = Number(process.env.PORT || 3000);
const hostname = '127.0.0.1';
const root = resolve(process.env.SCOPE_RECORDINGS_DIR || 'recordings');
const acquisition = new Acquisition(root);
const app = next({ dev, hostname, port });
await app.prepare();
const handle = app.getRequestHandler();
const clients = new Set<{ res: ServerResponse; revision: number }>();
let revision = 0, closing = false;
acquisition.subscribe(() => { revision++; });
const json = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
};

function event(res: ServerResponse) {
  // Never queue another update behind a slow reader; snapshots are replaceable.
  if (res.writableNeedDrain || res.writableLength > 65536) { res.destroy(); return; }
  res.write(`event: state\ndata: ${JSON.stringify(acquisition.snapshot())}\n\n`);
}

const updates = setInterval(() => {
  for (const client of clients) {
    if (client.revision !== revision) { event(client.res); client.revision = revision; }
  }
}, 100);
const heartbeat = setInterval(() => {
  for (const client of clients) {
    if (client.res.writableNeedDrain) client.res.destroy();
    else client.res.write(': connected\n\n');
  }
}, 15000);

async function readConfiguration(req: IncomingMessage) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1024) throw Object.assign(new Error('Request body is too large'), { statusCode: 413 });
  }
  return config(body ? JSON.parse(body) : {});
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${hostname}:${port}`);
  try {
    if (!url.pathname.startsWith('/api/')) return await handle(req, res);
    if (closing) return json(res, 503, { error: 'Application is shutting down' });
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, acquisition.snapshot());
    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.flushHeaders();
      const client = { res, revision };
      clients.add(client);
      res.on('close', () => clients.delete(client));
      event(res);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/acquisitions') {
      const settings = await readConfiguration(req);
      return json(res, 202, acquisition.start(settings));
    }
    if (req.method === 'GET' && url.pathname === '/api/recordings') {
      for (const key of url.searchParams.keys()) if (!['limit', 'cursor'].includes(key)) return json(res, 400, { error: `Unknown query parameter: ${key}` });
      return json(res, 200, await listRecordings(root, { limit: url.searchParams.get('limit') ?? undefined, cursor: url.searchParams.get('cursor') ?? undefined }));
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/recordings/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/recordings/'.length));
      if (!recordingId(id)) return json(res, 404, { error: 'Recording not found' });
      return json(res, 200, { ...await inspect(join(root, id)), location: join(root, id) });
    }
    const match = url.pathname.match(/^\/api\/acquisitions\/([a-f0-9-]{36})(\/stop)?$/);
    if (match) {
      const [, id, stop] = match;
      if (req.method === 'POST' && stop) {
        if (id !== acquisition.snapshot().id) return json(res, 404, { error: 'Acquisition not found' });
        return json(res, 202, acquisition.stop());
      }
      if (req.method === 'GET' && !stop) {
        const metadata = await inspect(join(root, id));
        return json(res, 200, { ...metadata, location: join(root, id) });
      }
    }
    json(res, 404, { error: 'Operation or recording not found' });
  } catch (cause) {
    const error = cause as Error & { code?: string; statusCode?: number };
    const status = error.code === 'ENOENT' ? 404 : error.statusCode || (error instanceof SyntaxError ? 400 : 500);
    json(res, status, { error: error.message, ...(error instanceof ConfigurationError ? { fields: error.fields } : {}) });
  }
});

server.listen(port, hostname, () => console.log(`SCOPE ready at http://${hostname}:${port}`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; shutdown(); });
async function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(updates);
  clearInterval(heartbeat);
  for (const { res } of clients) res.end();
  server.close();
  await acquisition.shutdown();
  await app.close();
  server.closeAllConnections();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
