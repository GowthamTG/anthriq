import { opendir } from 'node:fs/promises';
import { join } from 'node:path';
import { inspect } from './storage.ts';
import type { RecordingInspection } from './contracts.ts';

export interface LibraryEntry {
  id: string;
  recording?: RecordingInspection;
  error?: string;
}
export interface LibraryPage {
  items: LibraryEntry[];
  nextCursor: string | null;
}
export const recordingId = (id: string) => /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,254}$/.test(id);
const badRequest = (message: string): never => {
  throw Object.assign(new Error(message), { statusCode: 400 });
};

export async function listRecordings(
  root: string,
  options: { limit?: string | number; cursor?: string } = {},
): Promise<LibraryPage> {
  const limit = options.limit === undefined ? 10 : Number(options.limit);
  const cursor = options.cursor || '';
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    badRequest('Page limit must be an integer from 1 to 50');
  if (cursor && !recordingId(cursor)) badRequest('Invalid recording cursor');
  let directory;
  try {
    directory = await opendir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { items: [], nextCursor: null };
    throw error;
  }
  // Scan directory names with bounded memory; only inspect at most one page.
  // Lexical keyset ordering needs no persistent catalog or whole-library array.
  const names: string[] = [];
  for await (const entry of directory) {
    if (!entry.isDirectory() || !recordingId(entry.name) || entry.name <= cursor) continue;
    names.push(entry.name);
    names.sort();
    if (names.length > limit + 1) names.pop();
  }
  const more = names.length > limit;
  const selected = names.slice(0, limit);
  const items: LibraryEntry[] = [];
  for (const id of selected) {
    try {
      items.push({
        id,
        recording: { ...(await inspect(join(root, id))), location: join(root, id) },
      });
    } catch (error) {
      items.push({ id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { items, nextCursor: more ? selected.at(-1)! : null };
}
