import { createServer, type ServerResponse, type IncomingMessage } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import next from 'next';
import { Acquisition } from './core/acquisition.ts';
import {
  inspect,
  parseChannelList,
  previewFrames,
  rangeSelection,
  readFrames,
} from './core/storage.ts';
import { listRecordings, recordingId } from './core/library.ts';
import { config, ConfigurationError } from './core/config.ts';
import { Verification } from './core/verification.ts';
import {
  DIAGNOSTIC_SCENARIOS,
  type DiagnosticScenario,
  type PlaybackCommand,
  type PlaybackControlCommand,
} from './core/contracts.ts';
import { csvLines } from './core/export.ts';
import { PlaybackOwner } from './core/playback.ts';
import { eventFitsClientBuffer, MAX_CLIENT_BUFFER_BYTES } from './core/event-buffer.ts';

const dev = process.argv.includes('--dev');
const port = Number(process.env.PORT || 3000);
const hostname = '127.0.0.1';
const root = resolve(process.env.SCOPE_RECORDINGS_DIR || 'recordings');
const acquisition = new Acquisition(root);
const verification = new Verification(root);
const playback = new PlaybackOwner(root);
const app = next({ dev, hostname, port });
await app.prepare();
const handle = app.getRequestHandler();
const MAX_EVENT_CLIENTS = 8;
const MAX_EVENT_BYTES = 48 * 1024;
const MAX_DRAIN_MS = 2000;
const evidenceMode = process.env.SCOPE_EVIDENCE_MODE === '1';
type EventClient = {
  res: ServerResponse;
  revision: number;
  clientId?: string;
  draining: boolean;
  drainingSince: number;
  closeReason?: string;
};
const clients = new Set<EventClient>();
const observerDiagnostics = {
  opened: 0,
  closed: 0,
  replacements: 0,
  backpressureDisconnects: 0,
  oversizedEventDisconnects: 0,
  maxClients: 0,
  maxWritableLengthBytes: 0,
};
let revision = 0,
  closing = false;
acquisition.subscribe(() => {
  revision++;
});
verification.subscribe(() => {
  revision++;
});
playback.subscribe(() => {
  revision++;
});
const json = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
};
const rangeQuery = (url: URL) => {
  const permitted = ['channels', 'start', 'end', 'startSeconds', 'endSeconds', 'prefix'];
  for (const key of url.searchParams.keys())
    if (!permitted.includes(key) || url.searchParams.getAll(key).length !== 1)
      throw Object.assign(new Error(`Invalid range query parameter: ${key}`), { statusCode: 400 });
  const number = (key: string) => {
    const raw = url.searchParams.get(key);
    return raw === null ? undefined : Number(raw);
  };
  const rawPrefix = url.searchParams.get('prefix');
  if (rawPrefix !== null && !['true', 'false'].includes(rawPrefix))
    throw Object.assign(new Error('prefix must be true or false'), { statusCode: 400 });
  const rawChannels = url.searchParams.get('channels');
  return {
    channels: parseChannelList(rawChannels ?? undefined),
    start: number('start'),
    end: number('end'),
    startSeconds: number('startSeconds'),
    endSeconds: number('endSeconds'),
    prefix: rawPrefix === 'true',
  };
};
async function writeLines(res: ServerResponse, lines: AsyncIterable<string>) {
  for await (const line of lines) {
    if (res.destroyed) break;
    if (!res.write(line))
      await new Promise<void>((resolve) => {
        const done = () => {
          res.off('drain', done);
          res.off('close', done);
          resolve();
        };
        res.once('drain', done);
        res.once('close', done);
      });
    if (res.destroyed) break;
  }
}
async function streamLines(res: ServerResponse, lines: AsyncIterable<string>) {
  try {
    await writeLines(res, lines);
    if (!res.destroyed) res.end();
  } catch (error) {
    res.destroy(error as Error);
  }
}

function compactPreview(state: ReturnType<typeof acquisition.snapshot>) {
  while (state.preview?.buckets.length && state.preview.buckets.length > 1) {
    const body = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
    if (Buffer.byteLength(body) <= MAX_EVENT_BYTES) return;
    const merged = [];
    for (let index = 0; index < state.preview.buckets.length; index += 2) {
      const first = state.preview.buckets[index];
      const second = state.preview.buckets[index + 1];
      if (!second) merged.push(first);
      else
        merged.push({
          start: first.start,
          end: second.end,
          minimum: first.minimum.map((value, channel) => Math.min(value, second.minimum[channel])),
          maximum: first.maximum.map((value, channel) => Math.max(value, second.maximum[channel])),
        });
    }
    state.preview.buckets = merged;
    state.preview.bucketFrames *= 2;
    state.preview.capacity = Math.ceil(state.preview.capacity / 2);
  }
}

function eventBody(client: EventClient) {
  const state = acquisition.snapshot(client.clientId);
  compactPreview(state);
  return (
    `event: state\ndata: ${JSON.stringify(state)}\n\n` +
    `event: verification\ndata: ${JSON.stringify(verification.snapshot())}\n\n` +
    `event: playback\ndata: ${JSON.stringify(playback.snapshot())}\n\n`
  );
}

function event(client: EventClient) {
  if (client.res.destroyed) return;
  observerDiagnostics.maxWritableLengthBytes = Math.max(
    observerDiagnostics.maxWritableLengthBytes,
    client.res.writableLength,
  );
  if (client.draining) return;
  const body = eventBody(client);
  const bodyBytes = Buffer.byteLength(body);
  if (bodyBytes > MAX_CLIENT_BUFFER_BYTES) {
    client.closeReason = 'oversized-event';
    observerDiagnostics.oversizedEventDisconnects++;
    client.res.destroy();
    return;
  }
  if (!eventFitsClientBuffer(client.res.writableLength, bodyBytes)) {
    client.closeReason = 'backpressure';
    observerDiagnostics.backpressureDisconnects++;
    client.res.destroy();
    return;
  }
  client.revision = revision;
  if (!client.res.write(body)) {
    observerDiagnostics.maxWritableLengthBytes = Math.max(
      observerDiagnostics.maxWritableLengthBytes,
      client.res.writableLength,
    );
    client.draining = true;
    client.drainingSince = Date.now();
    client.res.once('drain', () => {
      client.draining = false;
      if (client.revision !== revision) event(client);
    });
  }
}

function evictExpiredDrain(client: EventClient) {
  if (client.draining && Date.now() - client.drainingSince > MAX_DRAIN_MS) {
    client.closeReason = 'backpressure';
    observerDiagnostics.backpressureDisconnects++;
    client.res.destroy();
    return true;
  }
  return false;
}

const updates = setInterval(() => {
  for (const client of clients) {
    if (evictExpiredDrain(client)) continue;
    if (client.revision !== revision) {
      event(client);
    }
  }
}, 100);
const heartbeat = setInterval(() => {
  for (const client of clients) {
    if (evictExpiredDrain(client)) continue;
    else if (!client.draining && !client.res.writableNeedDrain) client.res.write(': connected\n\n');
  }
}, 15000);

async function readConfiguration(req: IncomingMessage) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1024)
      throw Object.assign(new Error('Request body is too large'), { statusCode: 413 });
  }
  return config(body ? JSON.parse(body) : {});
}

async function readJson(req: IncomingMessage) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1024)
      throw Object.assign(new Error('Request body is too large'), { statusCode: 413 });
  }
  return body ? (JSON.parse(body) as unknown) : {};
}

const validClientId = (value: unknown) =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
function eventQuery(url: URL) {
  for (const key of url.searchParams.keys())
    if (!['clientId', 'channels'].includes(key) || url.searchParams.getAll(key).length !== 1)
      throw Object.assign(new Error(`Invalid event query parameter: ${key}`), { statusCode: 400 });
  const clientId = url.searchParams.get('clientId') ?? undefined;
  if (clientId && !validClientId(clientId))
    throw Object.assign(new Error('Invalid browser session'), { statusCode: 400 });
  const rawChannels = url.searchParams.get('channels');
  const channels = rawChannels === null ? undefined : rawChannels.split(',').map(Number);
  if (channels?.some((channel) => !Number.isSafeInteger(channel)))
    throw Object.assign(new Error('Preview channels must be integer indices'), { statusCode: 400 });
  return { clientId, channels };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${hostname}:${port}`);
  try {
    if (!url.pathname.startsWith('/api/')) return await handle(req, res);
    if (closing) return json(res, 503, { error: 'Application is shutting down' });
    if (req.method === 'GET' && url.pathname === '/api/state') {
      const { clientId } = eventQuery(url);
      if (clientId && !acquisition.hasPreviewSession(clientId))
        return json(res, 404, { error: 'Browser preview session is unavailable' });
      return json(res, 200, acquisition.snapshot(clientId));
    }
    if (req.method === 'GET' && url.pathname === '/api/verification')
      return json(res, 200, verification.snapshot());
    if (req.method === 'GET' && url.pathname === '/api/playback')
      return json(res, 200, playback.snapshot());
    if (req.method === 'GET' && url.pathname === '/api/diagnostics/observers' && evidenceMode)
      return json(res, 200, {
        ...observerDiagnostics,
        activeClients: clients.size,
        limits: {
          clients: MAX_EVENT_CLIENTS,
          eventBytes: MAX_EVENT_BYTES,
          clientBufferBytes: MAX_CLIENT_BUFFER_BYTES,
          drainMs: MAX_DRAIN_MS,
        },
        serverRssBytes: process.memoryUsage().rss,
        revision,
        clients: [...clients].map((client) => ({
          clientId: client.clientId ?? null,
          draining: client.draining,
          drainingForMs: client.draining ? Date.now() - client.drainingSince : 0,
          writableLengthBytes: client.res.writableLength,
        })),
      });
    if (req.method === 'GET' && url.pathname === '/api/events') {
      const { clientId, channels } = eventQuery(url);
      const replacing = [...clients].some((client) => clientId && client.clientId === clientId);
      if (clients.size >= MAX_EVENT_CLIENTS && !replacing)
        return json(res, 429, { error: 'At most eight live observers are supported' });
      const selected =
        channels ??
        Array.from({ length: Math.min(4, acquisition.snapshot().settings.channels) }, (_, i) => i);
      if (clientId) acquisition.validatePreviewChannels(selected);
      for (const existing of clients)
        if (clientId && existing.clientId === clientId) {
          existing.closeReason = 'replaced';
          observerDiagnostics.replacements++;
          existing.res.destroy();
        }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();
      const client: EventClient = {
        res,
        revision: -1,
        clientId,
        draining: false,
        drainingSince: 0,
      };
      clients.add(client);
      observerDiagnostics.opened++;
      observerDiagnostics.maxClients = Math.max(observerDiagnostics.maxClients, clients.size);
      if (clientId) acquisition.subscribePreview(clientId, selected);
      res.on('close', () => {
        clients.delete(client);
        observerDiagnostics.closed++;
        if (clientId && ![...clients].some((other) => other.clientId === clientId))
          acquisition.unsubscribePreview(clientId);
      });
      event(client);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/acquisitions') {
      const settings = await readConfiguration(req);
      return json(res, 202, acquisition.start(settings));
    }
    const previewControl = url.pathname.match(/^\/api\/acquisitions\/([^/]+)\/preview$/);
    if (req.method === 'POST' && previewControl) {
      const body = await readJson(req);
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).length !== 2 ||
        !validClientId((body as Record<string, unknown>).clientId) ||
        !Array.isArray((body as Record<string, unknown>).channels) ||
        !(body as { channels: unknown[] }).channels.every((channel) => typeof channel === 'number')
      )
        return json(res, 400, { error: 'Provide only preview channels' });
      const clientId = (body as { clientId: string }).clientId;
      if (![...clients].some((client) => client.clientId === clientId))
        return json(res, 409, { error: 'The browser preview session is not connected' });
      return json(
        res,
        200,
        acquisition.selectPreview(
          decodeURIComponent(previewControl[1]),
          clientId,
          (body as { channels: number[] }).channels,
        ),
      );
    }
    if (req.method === 'POST' && url.pathname === '/api/playback') {
      const body = await readJson(req);
      if (!body || typeof body !== 'object' || Array.isArray(body))
        return json(res, 400, { error: 'Provide a playback action and recordingId' });
      const command = body as Partial<PlaybackCommand> & Record<string, unknown>;
      const exact = (...keys: string[]) =>
        Object.keys(command).length === keys.length &&
        keys.every((key) => Object.hasOwn(command, key));
      if (typeof command.recordingId !== 'string')
        return json(res, 400, { error: 'Provide a playback action and recordingId' });
      if (!recordingId(command.recordingId))
        return json(res, 404, { error: 'Recording not found' });
      let state;
      if (command.action === 'open' && exact('action', 'recordingId'))
        state = await playback.open(command.recordingId);
      else if (
        (command.action === 'play' || command.action === 'pause' || command.action === 'restart') &&
        exact('action', 'recordingId')
      )
        state = await playback.control(command.recordingId, command as PlaybackControlCommand);
      else if (
        command.action === 'seek' &&
        ((exact('action', 'recordingId', 'position') && typeof command.position === 'number') ||
          (exact('action', 'recordingId', 'positionSeconds') &&
            typeof command.positionSeconds === 'number'))
      )
        state = await playback.control(command.recordingId, command as PlaybackControlCommand);
      else if (
        command.action === 'speed' &&
        exact('action', 'recordingId', 'speed') &&
        typeof command.speed === 'number'
      )
        state = await playback.control(command.recordingId, command as PlaybackControlCommand);
      else if (
        command.action === 'channels' &&
        exact('action', 'recordingId', 'channels') &&
        Array.isArray(command.channels) &&
        command.channels.every((channel) => typeof channel === 'number')
      )
        state = await playback.control(command.recordingId, command as PlaybackControlCommand);
      else
        return json(res, 400, {
          error: 'Provide one supported playback action with its required value',
        });
      return json(res, 200, state);
    }
    if (req.method === 'POST' && url.pathname === '/api/verifications') {
      const body = await readJson(req);
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        typeof (body as Record<string, unknown>).recordingId !== 'string' ||
        Object.keys(body).some((key) => key !== 'recordingId')
      ) {
        return json(res, 400, { error: 'Provide only a recordingId' });
      }
      return json(
        res,
        202,
        await verification.start((body as { recordingId: string }).recordingId),
      );
    }
    if (req.method === 'POST' && url.pathname === '/api/verification-scenarios') {
      const body = await readJson(req);
      if (!body || typeof body !== 'object' || Array.isArray(body))
        return json(res, 400, { error: 'Provide only a sourceRecordingId and scenario' });
      const input = body as Record<string, unknown>;
      if (
        typeof input.sourceRecordingId !== 'string' ||
        typeof input.scenario !== 'string' ||
        !DIAGNOSTIC_SCENARIOS.includes(input.scenario as DiagnosticScenario) ||
        Object.keys(input).some((key) => !['sourceRecordingId', 'scenario'].includes(key))
      ) {
        return json(res, 400, {
          error: 'Provide only a sourceRecordingId and a supported scenario',
        });
      }
      return json(
        res,
        202,
        await verification.startDiagnostic(
          input.sourceRecordingId,
          input.scenario as DiagnosticScenario,
        ),
      );
    }
    if (req.method === 'GET' && url.pathname === '/api/recordings') {
      for (const key of url.searchParams.keys())
        if (!['limit', 'cursor'].includes(key))
          return json(res, 400, { error: `Unknown query parameter: ${key}` });
      return json(
        res,
        200,
        await listRecordings(root, {
          limit: url.searchParams.get('limit') ?? undefined,
          cursor: url.searchParams.get('cursor') ?? undefined,
        }),
      );
    }
    const reportMatch = url.pathname.match(/^\/api\/recordings\/([^/]+)\/verification$/);
    if (req.method === 'GET' && reportMatch) {
      const id = decodeURIComponent(reportMatch[1]);
      if (!recordingId(id)) return json(res, 404, { error: 'Recording not found' });
      const path = join(root, id, 'verification.json');
      const reportStat = await stat(path);
      if (!reportStat.isFile() || reportStat.size > 65536)
        throw Object.assign(new Error('Verification report is unavailable'), { statusCode: 422 });
      const report = await readFile(path);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${id}-verification.json"`,
        'Cache-Control': 'no-store',
      });
      return res.end(report);
    }
    const previewMatch = url.pathname.match(/^\/api\/recordings\/([^/]+)\/range-preview$/);
    if (req.method === 'GET' && previewMatch) {
      const id = decodeURIComponent(previewMatch[1]);
      if (!recordingId(id)) return json(res, 404, { error: 'Recording not found' });
      return json(res, 200, await previewFrames(join(root, id), rangeQuery(url)));
    }
    const retrieveMatch = url.pathname.match(/^\/api\/recordings\/([^/]+)\/retrieve$/);
    if (req.method === 'GET' && retrieveMatch) {
      const id = decodeURIComponent(retrieveMatch[1]);
      if (!recordingId(id)) return json(res, 404, { error: 'Recording not found' });
      const query = rangeQuery(url);
      await rangeSelection(join(root, id), query);
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      return streamLines(
        res,
        (async function* () {
          for await (const frame of readFrames(join(root, id), query))
            yield JSON.stringify(frame) + '\n';
        })(),
      );
    }
    const exportMatch = url.pathname.match(/^\/api\/recordings\/([^/]+)\/export$/);
    if (req.method === 'GET' && exportMatch) {
      const id = decodeURIComponent(exportMatch[1]);
      if (!recordingId(id)) return json(res, 404, { error: 'Recording not found' });
      const format = url.searchParams.get('format');
      if (format !== 'csv' || url.searchParams.getAll('format').length !== 1)
        return json(res, 400, { error: 'Provide exactly format=csv' });
      const query = rangeQuery(
        new URL(
          `${url.pathname}?${[...url.searchParams]
            .filter(([key]) => key !== 'format')
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
            .join('&')}`,
          url,
        ),
      );
      await rangeSelection(join(root, id), query);
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${id}-selection.csv"`,
        'Cache-Control': 'no-store',
      });
      return streamLines(res, csvLines(join(root, id), query));
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/recordings/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/recordings/'.length));
      if (!recordingId(id)) return json(res, 404, { error: 'Recording not found' });
      return json(res, 200, { ...(await inspect(join(root, id))), location: join(root, id) });
    }
    const match = url.pathname.match(/^\/api\/acquisitions\/([a-f0-9-]{36})(\/stop)?$/);
    if (match) {
      const [, id, stop] = match;
      if (req.method === 'POST' && stop) {
        if (id !== acquisition.snapshot().id)
          return json(res, 404, { error: 'Acquisition not found' });
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
    const status =
      error.code === 'ENOENT'
        ? 404
        : error.statusCode || (error instanceof SyntaxError ? 400 : 500);
    json(res, status, {
      error: error.message,
      ...(error instanceof ConfigurationError ? { fields: error.fields } : {}),
    });
  }
});

server.listen(port, hostname, () => console.log(`SCOPE ready at http://${hostname}:${port}`));
server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
  shutdown();
});
async function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(updates);
  clearInterval(heartbeat);
  for (const { res } of clients) res.end();
  server.close();
  await Promise.all([acquisition.shutdown(), verification.shutdown(), playback.shutdown()]);
  await app.close();
  server.closeAllConnections();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
