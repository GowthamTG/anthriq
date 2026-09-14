import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateJsonSchema } from './validate-json-schema.mjs';

const schemaDirectory = resolve('docs/evidence/t15');

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function validateFile(directory, name, schemaName) {
  const [document, schema] = await Promise.all([
    json(join(directory, name)),
    json(join(schemaDirectory, schemaName)),
  ]);
  validateJsonSchema(document, schema);
}

async function validateJsonLines(directory, name, schemaName) {
  const [text, schema] = await Promise.all([
    readFile(join(directory, name), 'utf8'),
    json(join(schemaDirectory, schemaName)),
  ]);
  for (const [index, line] of text.split('\n').entries()) {
    if (!line) continue;
    validateJsonSchema(JSON.parse(line), schema, `${name}:${index + 1}`);
  }
}

export async function validateAcquisitionEvidence(directory = 'docs/evidence/t15') {
  const output = resolve(directory);
  await Promise.all([
    validateFile(output, 'environment.json', 'environment.schema.json'),
    validateFile(output, 'metadata.json', 'metadata.schema.json'),
    validateFile(output, 'verification.json', 'verification.schema.json'),
    validateFile(output, 'run-summary.json', 'run-summary.schema.json'),
    validateFile(schemaDirectory, 'browser-verification.json', 'browser-verification.schema.json'),
    validateJsonLines(output, 'metrics.jsonl', 'metrics.schema.json'),
    validateJsonLines(output, 'losses.jsonl', 'loss.schema.json'),
  ]);
  return output;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2] ?? 'docs/evidence/t15';
  await validateAcquisitionEvidence(directory);
  process.stdout.write(`${directory} matches the T15 evidence schemas\n`);
}
