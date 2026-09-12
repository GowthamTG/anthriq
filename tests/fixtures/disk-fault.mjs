// Child-process-only OS I/O fault adapter. Real files, offsets, writes and processes
// remain in use; only the selected frame handle's write result is controlled.
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const originalOpen = fs.open;
fs.open = async function (path, ...args) {
  const handle = await originalOpen.call(this, path, ...args);
  if (['short', 'ENOSPC'].includes(process.env.SCOPE_TEST_DISK_FAULT) && String(path).endsWith('/frames.bin') && args[0] === 'wx') {
    const write = handle.write.bind(handle);
    let bytes = 0;
    handle.write = async (buffer, offset, length, ...rest) => {
      if (process.env.SCOPE_TEST_DISK_FAULT === 'ENOSPC' && bytes >= 141) {
        throw Object.assign(new Error('ENOSPC: no space left on device, write frames.bin (controlled test)'), { code: 'ENOSPC' });
      }
      const result = await write(buffer, offset, Math.min(length, process.env.SCOPE_TEST_DISK_FAULT === 'ENOSPC' ? 141 - bytes : 17), ...rest);
      bytes += result.bytesWritten;
      return result;
    };
  }
  return handle;
};
const originalRename = fs.rename;
fs.rename = async function (from, to) {
  if (process.env.SCOPE_TEST_DISK_FAULT === 'finalize' && String(to).endsWith('/metadata.json')) {
    const metadata = JSON.parse(await fs.readFile(from, 'utf8'));
    if (metadata.status === 'completed') throw new Error('EACCES: metadata finalization denied (controlled test)');
  }
  return originalRename.call(this, from, to);
};
syncBuiltinESMExports();
if (process.env.SCOPE_TEST_DISK_FAULT === 'recorder-ipc' && process.argv[1]?.endsWith('/recorder.ts')) {
  setTimeout(() => process.disconnect(), 250);
}
