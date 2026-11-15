import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiBase, integerOption, isFreeKey, normalizeConfig } from '../src/config.js';
import { API_FREE, API_PRO, CONFIG } from '../src/constants.js';

test('integer options: strict, bounded, defaults for empty or text', () => {
  const key = CONFIG.MAX_PER_CALL;
  assert.equal(integerOption(undefined, key), 1000);
  assert.equal(integerOption('', key), 1000);
  assert.equal(integerOption('abc', key), 1000);
  assert.equal(integerOption('12.5', key), 1000);
  assert.equal(integerOption(12.5, key), 1000);
  assert.equal(integerOption(' 42 ', key), 42);
  assert.equal(integerOption(0, key), 1);
  assert.equal(integerOption(99999, key), 5000);
  assert.equal(integerOption(50, CONFIG.MAX_PER_DAY), 100);
  assert.equal(integerOption(5e6, CONFIG.MAX_PER_DAY), 1000000);
});

test('the key: trimmed, refused with a space, CR/LF or a control, never echoed', () => {
  assert.deepEqual(normalizeConfig({}).issues, ['no_key']);
  for (const bad of [
    'short',
    'a b c d e f g h',
    'abcdefgh\r\nX: y',
    'abcdefgh\u0000',
    'clé-accentuée-1',
  ]) {
    const c = normalizeConfig({ api_key: bad });
    assert.deepEqual(c.issues, ['bad_key'], JSON.stringify(bad));
    assert.equal(c.apiKey, '');
  }
  const c = normalizeConfig({ api_key: '  abcdefgh-1234:fx  ' });
  assert.equal(c.apiKey, 'abcdefgh-1234:fx');
  assert.equal(c.free, true);
  assert.deepEqual(c.issues, []);
});

test('Free keys (":fx") go to api-free.deepl.com, the others to api.deepl.com', () => {
  assert.equal(isFreeKey('abc:fx'), true);
  assert.equal(isFreeKey('abc:FX'), false);
  assert.equal(isFreeKey('abc'), false);
  assert.equal(apiBase('abc:fx'), API_FREE);
  assert.equal(apiBase('abc'), API_PRO);
  assert.equal(API_FREE, 'https://api-free.deepl.com');
  assert.equal(API_PRO, 'https://api.deepl.com');
});
