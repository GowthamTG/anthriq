import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand } from './handoff-evidence.mjs';

export function localMarkdownTargets(markdown) {
  return [...markdown.matchAll(/!?(?:\[[^\]]*\])\(([^)]+)\)/g)]
    .map((match) => match[1].trim().replace(/^<|>$/g, ''))
    .filter(
      (target) =>
        target &&
        !target.startsWith('#') &&
        !target.startsWith('http://') &&
        !target.startsWith('https://') &&
        !target.startsWith('mailto:'),
    )
    .map((target) => decodeURIComponent(target.split('#')[0]));
}

export async function checkMarkdownLinks(root = resolve('.')) {
  const listed = await runCommand('git', ['ls-files', '*.md'], { cwd: root });
  assert.equal(
    listed.stdoutBytes,
    Buffer.byteLength(listed.stdoutTail),
    'Markdown file list exceeded bound',
  );
  const files = listed.stdoutTail.trim().split('\n').filter(Boolean);
  let links = 0;
  for (const file of files) {
    const markdown = await readFile(resolve(root, file), 'utf8');
    for (const target of localMarkdownTargets(markdown)) {
      links++;
      try {
        await access(resolve(root, dirname(file), target));
      } catch {
        throw new Error(`${file}: missing local Markdown target ${target}`);
      }
    }
  }
  return { files: files.length, links };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await checkMarkdownLinks();
  process.stdout.write(
    `Checked ${result.links} local links across ${result.files} Markdown files\n`,
  );
}
