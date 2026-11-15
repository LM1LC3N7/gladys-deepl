import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeeplError, readBounded, request, retryAfterMs } from '../src/http.js';
import { fetchError, json } from './helpers/app.js';

const call = (out, { get = false } = {}) =>
  request('https://api-free.deepl.com', '/v2/translate', {
    apiKey: 'k'.repeat(20),
    body: get ? undefined : { x: 1 },
    fetchImpl: async () => {
      if (typeof out === 'string') throw fetchError(out);
      return out;
    },
    now: () => Date.parse('2026-11-15T09:00:00Z'),
  });

test('Retry-After: seconds or an HTTP date, nothing else', () => {
  const now = Date.parse('2026-11-15T09:00:00Z');
  assert.equal(retryAfterMs('120', now), 120_000);
  assert.equal(retryAfterMs('Sun, 15 Nov 2026 09:05:00 GMT', now), 300_000);
  assert.equal(retryAfterMs('Sun, 15 Nov 2026 08:00:00 GMT', now), 0);
  for (const bad of [undefined, '', '-5', '1.5', '2026-11-15', 'x'.repeat(100)]) {
    assert.equal(retryAfterMs(bad, now), undefined, String(bad));
  }
});

test('a body larger than the bound is cut before being read whole', async () => {
  const declared = new Response('x', { headers: { 'content-length': '999999' } });
  await assert.rejects(readBounded(declared, 100), { code: 'too_large' });
  let pulled = 0;
  const stream = new ReadableStream({
    pull(controller) {
      pulled += 1;
      controller.enqueue(new Uint8Array(1000));
      if (pulled > 1000) controller.close();
    },
  });
  await assert.rejects(readBounded(new Response(stream), 5000), { code: 'too_large' });
  assert.ok(pulled < 20, `stopped early (${pulled} chunks)`);
  assert.equal(await readBounded(new Response('{"a":1}'), 100), '{"a":1}');
});

test('each status says whether DeepL may have counted the translation', async () => {
  for (const [out, code, sent] of [
    [json({}, 400), 'invalid', 'no'],
    [json({}, 401), 'refused', 'no'],
    [json({}, 403), 'refused', 'no'],
    [json({}, 404), 'http', 'no'],
    [json({}, 413), 'too_long', 'no'],
    [json({}, 414), 'too_long', 'no'],
    [json({}, 429), 'rate_limited', 'no'],
    [json({}, 456), 'quota', 'no'],
    [json({}, 529), 'rate_limited', 'no'],
    [json({}, 500), 'server', 'maybe'],
    [json({}, 504), 'server', 'maybe'],
    [new Response(null, { status: 301 }), 'redirect', 'no'],
    ['timeout', 'timeout', 'maybe'],
    ['ECONNRESET', 'network', 'maybe'],
    ['UND_ERR_SOCKET', 'network', 'maybe'],
    ['ENOTFOUND', 'network', 'no'],
    ['ECONNREFUSED', 'network', 'no'],
    ['UND_ERR_CONNECT_TIMEOUT', 'network', 'no'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'network', 'no'],
  ]) {
    await assert.rejects(call(out), (err) => {
      assert.ok(err instanceof DeeplError);
      assert.equal(err.code, code, `${out.status ?? out}`);
      assert.equal(err.sent, sent, `${out.status ?? out}`);
      return true;
    });
  }
  // A GET (the check) never "may have been counted".
  await assert.rejects(call('timeout', { get: true }), { code: 'timeout', sent: 'no' });
  await assert.rejects(call(json({}, 500), { get: true }), { code: 'server', sent: 'no' });
});

test('an error never carries the free text of DeepL nor the key', async () => {
  await assert.rejects(call(json({ message: 'Wrong PRIVATE text' }, 400)), (err) => {
    assert.ok(!JSON.stringify({ ...err, m: err.message }).includes('PRIVATE'));
    assert.ok(!err.message.includes('kkkk'));
    return true;
  });
});

test('429: Retry-After read against the Date of the answer', async () => {
  const at = 'Sun, 15 Nov 2026 10:00:00 GMT';
  await assert.rejects(
    call(json({}, 429, { date: at, 'retry-after': 'Sun, 15 Nov 2026 10:02:00 GMT' })),
    { code: 'rate_limited', retryAfter: 120_000 },
  );
  await assert.rejects(call(json({}, 429)), (err) => err.retryAfter === undefined);
});

test('a 2xx whose body does not read resolves json undefined', async () => {
  const out = await call(new Response('not json', { status: 200 }));
  assert.equal(out.json, undefined);
});
