import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countChars, cut } from '../src/text.js';

test('characters are code points: an emoji is one', () => {
  assert.equal(countChars('abc'), 3);
  assert.equal(countChars('😀é'), 2);
  assert.equal(countChars(''), 0);
});

test('cut keeps at most max units and never half a surrogate pair', () => {
  assert.deepEqual(cut('abc', 5), { text: 'abc', truncated: false });
  assert.deepEqual(cut('abcdef', 3), { text: 'abc', truncated: true });
  assert.deepEqual(cut('ab😀', 3), { text: 'ab', truncated: true });
  assert.deepEqual(cut('ab😀', 4), { text: 'ab😀', truncated: false });
});
