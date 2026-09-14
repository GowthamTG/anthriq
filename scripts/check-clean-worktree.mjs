import { spawnSync } from 'node:child_process';

function git(...args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr || `git ${args.join(' ')} failed\n`);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

const status = git('status', '--porcelain=v1', '--untracked-files=all');
if (!status) {
  process.stdout.write('Working tree is clean.\n');
  process.exit(0);
}

process.stderr.write('Working tree is not clean:\n');
process.stderr.write(status);
const unstaged = git('diff', '--no-ext-diff', '--');
const staged = git('diff', '--cached', '--no-ext-diff', '--');
if (unstaged) process.stderr.write(`\nUnstaged diff:\n${unstaged}`);
if (staged) process.stderr.write(`\nStaged diff:\n${staged}`);
process.exit(1);
