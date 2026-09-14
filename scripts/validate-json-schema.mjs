import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const actualType = (value) =>
  value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;

export function validateJsonSchema(value, schema, path = '$') {
  if (schema.const !== undefined) assert.deepEqual(value, schema.const, `${path}: const`);
  if (schema.enum) assert.ok(schema.enum.includes(value), `${path}: enum`);
  if (schema.type) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    const type = actualType(value);
    assert.ok(
      expected.includes(type) || (expected.includes('integer') && Number.isInteger(value)),
      `${path}: expected ${expected.join('|')}, received ${type}`,
    );
  }
  if (typeof value === 'number' && schema.minimum !== undefined)
    assert.ok(value >= schema.minimum, `${path}: minimum ${schema.minimum}`);
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined)
      assert.ok(value.length >= schema.minItems, `${path}: minItems ${schema.minItems}`);
    if (schema.maxItems !== undefined)
      assert.ok(value.length <= schema.maxItems, `${path}: maxItems ${schema.maxItems}`);
    if (schema.items)
      value.forEach((item, index) => validateJsonSchema(item, schema.items, `${path}[${index}]`));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required ?? [])
      assert.ok(Object.hasOwn(value, key), `${path}: missing required property ${key}`);
    if (schema.additionalProperties === false)
      for (const key of Object.keys(value))
        assert.ok(
          Object.hasOwn(schema.properties ?? {}, key),
          `${path}: unexpected property ${key}`,
        );
    for (const [key, child] of Object.entries(schema.properties ?? {}))
      if (Object.hasOwn(value, key)) validateJsonSchema(value[key], child, `${path}.${key}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [documentPath, schemaPath] = process.argv.slice(2);
  if (!documentPath || !schemaPath) {
    process.stderr.write('Usage: validate-json-schema.mjs <document.json> <schema.json>\n');
    process.exit(2);
  }
  const [document, schema] = await Promise.all(
    [documentPath, schemaPath].map(async (path) =>
      JSON.parse(await readFile(resolve(path), 'utf8')),
    ),
  );
  validateJsonSchema(document, schema);
  process.stdout.write(`${documentPath} matches ${schemaPath}\n`);
}
