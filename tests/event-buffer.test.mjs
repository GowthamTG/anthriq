import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventFitsClientBuffer, MAX_CLIENT_BUFFER_BYTES } from '../core/event-buffer.ts';

test('an SSE event is rejected before it can exceed the writable-buffer ceiling', () => {
  assert.equal(eventFitsClientBuffer(0, MAX_CLIENT_BUFFER_BYTES), true);
  assert.equal(eventFitsClientBuffer(1, MAX_CLIENT_BUFFER_BYTES - 1), true);
  assert.equal(eventFitsClientBuffer(1, MAX_CLIENT_BUFFER_BYTES), false);
  assert.equal(eventFitsClientBuffer(MAX_CLIENT_BUFFER_BYTES, 1), false);
  assert.equal(eventFitsClientBuffer(0, MAX_CLIENT_BUFFER_BYTES + 1), false);
});

test('invalid byte counts cannot bypass the SSE buffer bound', () => {
  for (const value of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(eventFitsClientBuffer(value, 1), false);
    assert.equal(eventFitsClientBuffer(1, value), false);
  }
});
