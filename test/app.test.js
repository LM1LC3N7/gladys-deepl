import { test } from 'node:test';
import assert from 'node:assert/strict';
import { App, keyMark } from '../src/app.js';
import { USER_AGENT } from '../src/constants.js';
import { createMemoryStore } from '../src/store.js';
import {
  BASE_CONFIG,
  FIELDS,
  HOUR,
  KEY,
  MINUTE,
  NOW,
  PRO_KEY,
  SECOND,
  TEXT,
  json,
  leaked,
  setup,
  translated,
} from './helpers/app.js';

const status = (gladys) => gladys.fake.connectionStatus;
const callsOf = (store) => store.data?.calls ?? [];
const counted = (store) => callsOf(store).reduce((s, c) => s + c.chars, 0);
const LEN = [...TEXT].length;

test('nothing is sent at start, on a reconnection nor on a configuration change', async () => {
  const ctx = await setup();
  await ctx.gladys.fake.configUpdated({ ...BASE_CONFIG, max_chars_per_day: 500 });
  await ctx.gladys.disconnect();
  await ctx.gladys.connect();
  await ctx.wait(2 * HOUR);
  assert.equal(ctx.api.requests.length, 0);
  assert.equal(status(ctx.gladys).connected, true);
  assert.match(
    status(ctx.gladys).message.en,
    /DeepL API Free key.*1,000 characters per call.*500 over 24 hours/,
  );
  await ctx.app.stop();
});

test('a scene translates with the documented request (Free host for a ":fx" key) and outputs', async () => {
  const ctx = await setup();
  const ack = await ctx.scene({ ...FIELDS, source_lang: 'FR', formality: 'prefer_more' });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, {
    translation: 'The gate stayed open PRIVATE-TRANSLATION',
    detected_language: 'FR',
    characters: LEN,
    truncated: false,
  });
  const [r] = ctx.api.requests;
  assert.equal(r.url, 'https://api-free.deepl.com/v2/translate');
  assert.equal(r.method, 'POST');
  assert.equal(r.headers.Authorization, `DeepL-Auth-Key ${KEY}`);
  assert.equal(r.headers.Accept, 'application/json');
  assert.equal(r.headers['Content-Type'], 'application/json');
  assert.equal(r.headers['User-Agent'], USER_AGENT);
  assert.equal(r.init.redirect, 'manual');
  assert.ok(r.init.signal, 'a timeout');
  assert.deepEqual(r.body, {
    text: [TEXT],
    target_lang: 'EN-US',
    source_lang: 'FR',
    formality: 'prefer_more',
    show_billed_characters: true,
  });
  assert.equal(counted(ctx.store), LEN);
  await ctx.app.stop();
});

test('a Pro key goes to api.deepl.com; default formality and no source are left out', async () => {
  const ctx = await setup({ config: { api_key: PRO_KEY } });
  const ack = await ctx.scene({ ...FIELDS, formality: 'default', source_lang: '' });
  assert.equal(ack.success, true, ack.error);
  const [r] = ctx.api.requests;
  assert.equal(r.url, 'https://api.deepl.com/v2/translate');
  assert.deepEqual(r.body, { text: [TEXT], target_lang: 'EN-US', show_billed_characters: true });
  assert.match(status(ctx.gladys).message.en, /DeepL API Pro key/);
  await ctx.app.stop();
});

test('the key, the text and the translation never reach a log, a status, /data nor an error', async () => {
  const ctx = await setup({
    handler: () =>
      ctx.api.requests.length === 2
        ? new Response('{"message":"bad PRIVATE"}', { status: 400 })
        : undefined,
  });
  await ctx.scene();
  const bad = await ctx.scene();
  assert.equal(bad.success, false);
  const all = `${leaked(ctx)}\n${bad.error}`;
  for (const secret of ['SECRETKEY999', 'PRIVATE']) assert.ok(!all.includes(secret), secret);
  await ctx.app.stop();
});

test('wrong fields are refused before anything leaves', async () => {
  const ctx = await setup({ config: { ...BASE_CONFIG, max_chars_per_call: 10 } });
  const cases = [
    [{ target_lang: 'EN-US', text: '   ' }, /text is empty/],
    [{ target_lang: 'EN-US', text: '12345678901' }, /longer than the maximum characters per call/],
    [{ target_lang: 'XX', text: 'hello' }, /unknown target language/],
    [{ target_lang: 'EN-US', text: 'hello', source_lang: 'EN-US' }, /unknown source language/],
    [{ target_lang: 'EN-US', text: 'hello', formality: 'more' }, /unknown formality/],
  ];
  for (const [fields, error] of cases) {
    const ack = await ctx.scene(fields);
    assert.equal(ack.success, false);
    assert.match(ack.error, error);
    assert.match(ack.error, /^Nothing sent to DeepL/);
  }
  // Ten code points (emoji included) fit a cap of 10.
  const ok = await ctx.scene({ target_lang: 'DE', text: '😀😀😀😀😀abcde' });
  assert.equal(ok.success, true, ok.error);
  assert.equal(ctx.api.requests.length, 1);
  await ctx.app.stop();
});

test('the daily cap: counted before the request, refused beyond, freed 24 hours later', async () => {
  const ctx = await setup({ config: { ...BASE_CONFIG, max_chars_per_day: 100 } });
  let seen;
  ctx.api.handler = () => {
    seen = counted(ctx.store);
    return undefined;
  };
  assert.equal((await ctx.scene({ ...FIELDS, text: 'a'.repeat(60) })).success, true);
  assert.equal(seen, 60, 'saved in /data before the request left');
  const over = await ctx.scene({ ...FIELDS, text: 'a'.repeat(41) });
  assert.match(over.error, /cap of characters over 24 hours/);
  assert.equal((await ctx.scene({ ...FIELDS, text: 'a'.repeat(40) })).success, true);
  assert.equal(ctx.api.requests.length, 2);
  await ctx.wait(24 * HOUR - 2 * MINUTE);
  assert.match((await ctx.scene({ ...FIELDS, text: 'a' })).error, /cap/);
  await ctx.wait(3 * MINUTE);
  assert.equal((await ctx.scene({ ...FIELDS, text: 'a'.repeat(60) })).success, true);
  await ctx.app.stop();
});

test('the daily cap survives a restart; a /data date in the future counts as now', async () => {
  const store = createMemoryStore({
    calls: [
      { wall: NOW - 23 * HOUR, chars: 50 },
      { wall: NOW + 5 * HOUR, chars: 40 },
      { wall: NOW - 25 * HOUR, chars: 1000 },
      { wall: 'x', chars: 1000 },
      { wall: NOW, chars: -1 },
    ],
  });
  const ctx = await setup({ store, config: { ...BASE_CONFIG, max_chars_per_day: 100 } });
  assert.match((await ctx.scene({ ...FIELDS, text: 'a'.repeat(11) })).error, /cap/);
  assert.equal((await ctx.scene({ ...FIELDS, text: 'a'.repeat(10) })).success, true);
  await ctx.app.stop();
  const again = await setup({ store, config: { ...BASE_CONFIG, max_chars_per_day: 100 } });
  assert.match((await again.scene({ ...FIELDS, text: 'a' })).error, /cap/);
  // 1 h 1 min later the 50 of 23 hours ago are gone; the future-dated 40 stay.
  await again.wait(HOUR + MINUTE);
  assert.equal((await again.scene({ ...FIELDS, text: 'a'.repeat(50) })).success, true);
  assert.match((await again.scene({ ...FIELDS, text: 'a' })).error, /cap/);
  assert.equal(again.api.requests.length, 1);
  await again.app.stop();
});

test('billed_characters larger than the count raises it; a smaller one never lowers it', async () => {
  const ctx = await setup({ config: { ...BASE_CONFIG, max_chars_per_day: 100 } });
  ctx.api.handler = () => translated('x', 70);
  const ack = await ctx.scene({ ...FIELDS, text: 'a'.repeat(20) });
  assert.equal(ack.data.outputs.characters, 70);
  ctx.api.handler = () => translated('x', 1);
  assert.equal((await ctx.scene({ ...FIELDS, text: 'a'.repeat(20) })).data.outputs.characters, 20);
  assert.equal(counted(ctx.store), 90);
  assert.match((await ctx.scene({ ...FIELDS, text: 'a'.repeat(11) })).error, /cap/);
  await ctx.app.stop();
});

test('a failed save refuses the translation; an unreadable /data refuses too', async () => {
  const store = createMemoryStore();
  const ctx = await setup({ store });
  store.failSave = true;
  const ack = await ctx.scene();
  assert.match(ack.error, /count could not be saved/);
  assert.equal(ctx.api.requests.length, 0);
  assert.match(status(ctx.gladys).message.en, /could not be written/);
  store.failSave = false;
  assert.equal((await ctx.scene()).success, true);
  await ctx.app.stop();

  const broken = createMemoryStore({ calls: [] });
  broken.unreadable = true;
  const b = await setup({ store: broken });
  assert.match((await b.scene()).error, /unreadable/);
  assert.equal(b.api.requests.length, 0);
  assert.equal(status(b.gladys).connected, false);
  assert.equal(broken.saves, 0, 'never written over');
  broken.unreadable = false;
  await b.wait(11 * SECOND);
  assert.equal(status(b.gladys).connected, true);
  assert.equal((await b.scene()).success, true);
  await b.app.stop();
});

test('a hung save never sends: refused within its bound', async () => {
  const store = createMemoryStore();
  const ctx = await setup({ store });
  store.save = () => new Promise(() => {});
  const pending = ctx.scene();
  await ctx.clock.advance(0);
  await ctx.wait(4 * SECOND);
  const ack = await pending;
  assert.match(ack.error, /count could not be saved/);
  assert.equal(ctx.api.requests.length, 0);
  await ctx.app.stop();
});

test('a translation that may have been counted is kept and never tried again', async () => {
  for (const failure of ['timeout', 'ECONNRESET', 503]) {
    const ctx = await setup({
      handler: () => (typeof failure === 'number' ? json({}, failure) : failure),
    });
    const ack = await ctx.scene();
    assert.equal(ack.success, false);
    assert.match(ack.error, /^Sent to DeepL without an answer \(may be counted, not tried again\)/);
    assert.equal(ctx.api.requests.length, 1, `${failure}: one request`);
    assert.equal(counted(ctx.store), LEN, `${failure}: kept in the cap`);
    await ctx.app.stop();
  }
});

test('a translation DeepL surely did not take is given back', async () => {
  for (const [failure, reason] of [
    [400, /refused by DeepL \(400\)/],
    [413, /refused the size of the request \(413\)/],
    [401, /DeepL answered 401 \(not taken as a refusal/],
    ['ENOTFOUND', /network error/],
    ['ECONNREFUSED', /network error/],
    [302, /unexpected redirect/],
    [404, /unexpected answer/],
  ]) {
    const ctx = await setup({
      handler: () => (typeof failure === 'number' ? json({}, failure) : failure),
    });
    const ack = await ctx.scene();
    assert.match(ack.error, reason, String(failure));
    assert.match(ack.error, /^Nothing sent to DeepL/);
    assert.equal(counted(ctx.store), 0, `${failure}: given back`);
    await ctx.app.stop();
  }
});

test('a 2xx without a readable translation is counted and fails the action', async () => {
  const ctx = await setup({ handler: () => json({ translations: [{}] }) });
  const ack = await ctx.scene();
  assert.match(ack.error, /no readable translation/);
  assert.equal(counted(ctx.store), LEN);
  await ctx.app.stop();
});

test('a translation over 10,000 characters is cut, never half an emoji', async () => {
  const long = `${'a'.repeat(9999)}😀tail`;
  const ctx = await setup({ handler: () => translated(long, LEN, 'XX-<script>') });
  const { outputs } = (await ctx.scene()).data;
  assert.equal(outputs.truncated, true);
  assert.equal(outputs.translation, 'a'.repeat(9999));
  assert.equal(outputs.detected_language, '', 'an unexpected language code is not relayed');
  await ctx.app.stop();
});

test('an answer too large is cut before being read whole, and counted', async () => {
  const big = JSON.stringify({ translations: [{ text: 'x'.repeat(300 * 1024) }] });
  const ctx = await setup({
    handler: () =>
      new Response(big, { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  const ack = await ctx.scene();
  assert.match(ack.error, /no readable translation/);
  assert.equal(counted(ctx.store), LEN);
  await ctx.app.stop();
});

test('5xx: a pause of 60 s, doubled on repeat, kept in /data across a restart', async () => {
  const store = createMemoryStore();
  const ctx = await setup({ store, handler: () => json({}, 500) });
  await ctx.scene();
  assert.match(
    status(ctx.gladys).message.en,
    /DeepL is failing \(5xx\): nothing is translated for about 1 min/,
  );
  assert.match((await ctx.scene()).error, /DeepL asked for a pause/);
  assert.equal(ctx.api.requests.length, 1);
  await ctx.wait(61 * SECOND);
  await ctx.scene();
  assert.equal(ctx.api.requests.length, 2);
  await ctx.app.stop();
  const again = await setup({ store, now: NOW + 61 * SECOND });
  assert.match((await again.scene()).error, /pause/);
  await again.wait(115 * SECOND);
  assert.match((await again.scene()).error, /pause/, '120 s after the second 5xx');
  await again.wait(10 * SECOND);
  assert.equal((await again.scene()).success, true);
  assert.equal(store.data.pause.streak, 0, 'a success resets the streak');
  await again.app.stop();
});

test('429 follows Retry-After (bounded 60 s..6 h); 529 too; 456 pauses 1 hour', async () => {
  const ctx = await setup({ handler: () => json({}, 429, { 'retry-after': '120' }) });
  await ctx.scene();
  assert.equal(counted(ctx.store), 0, 'a 429 is not counted');
  await ctx.wait(110 * SECOND);
  assert.match((await ctx.scene()).error, /pause/);
  await ctx.wait(11 * SECOND);
  ctx.api.handler = () => json({}, 529, { 'retry-after': '999999' });
  await ctx.scene();
  assert.equal(ctx.api.requests.length, 2);
  await ctx.wait(6 * HOUR - MINUTE);
  assert.match((await ctx.scene()).error, /pause/);
  await ctx.wait(2 * MINUTE);
  ctx.api.handler = () => json({}, 456);
  const quota = await ctx.scene();
  assert.match(quota.error, /DeepL quota reached \(456: the character quota of the account/);
  assert.match(status(ctx.gladys).message.en, /quota reached \(456/);
  assert.equal(counted(ctx.store), 0);
  await ctx.wait(59 * MINUTE);
  assert.match((await ctx.scene()).error, /456/);
  assert.equal(ctx.api.requests.length, 3);
  await ctx.wait(2 * MINUTE + 10 * MINUTE);
  ctx.api.handler = undefined;
  assert.equal((await ctx.scene()).success, true);
  await ctx.app.stop();
});

test('a 403 of a translation blocks the key; a new key is always tried', async () => {
  const store = createMemoryStore();
  const ctx = await setup({ store, handler: () => json({}, 403) });
  assert.match((await ctx.scene()).error, /API key was refused \(403\)/);
  assert.equal(status(ctx.gladys).connected, false);
  assert.match(status(ctx.gladys).message.en, /refused the API key/);
  ctx.api.handler = undefined;
  assert.match((await ctx.scene()).error, /refused/);
  assert.equal(ctx.api.requests.length, 1, 'never sent again by a scene');
  assert.match(store.data.refused, /^[0-9a-f]{2}$/);
  assert.ok(!JSON.stringify(store.data).includes(KEY));
  await ctx.app.stop();
  // Kept across a restart.
  const again = await setup({ store });
  assert.match((await again.scene()).error, /refused/);
  assert.equal(again.api.requests.length, 0);
  // A new key, even with the same 8-bit mark, is tried.
  await again.gladys.fake.configUpdated({ api_key: PRO_KEY });
  assert.equal((await again.scene()).success, true);
  await again.app.stop();
});

test('the check button: usage read, no character counted, lifts a refusal; its 403 marks nothing', async () => {
  const ctx = await setup();
  await ctx.scene({ ...FIELDS, text: 'abc' });
  const ok = await ctx.gladys.fake.action('check_account', {});
  assert.equal(ok.success, true);
  assert.match(
    ok.data.message.en,
    /DeepL accepted the key \(DeepL API Free\)\. DeepL account: 1,234 of 500,000 characters.*This module: 3 of 10,000/,
  );
  const usage = ctx.api.requests.at(-1);
  assert.equal(usage.url, 'https://api-free.deepl.com/v2/usage');
  assert.equal(usage.method, 'GET');
  assert.equal(counted(ctx.store), 3);

  ctx.api.handler = () => json({}, 403);
  const refused = await ctx.gladys.fake.action('check_account', {});
  assert.match(refused.data.message.en, /does not block the scenes/);
  ctx.api.handler = undefined;
  assert.equal((await ctx.scene()).success, true, 'a 403 of the usage route is not a refusal');

  ctx.api.handler = (r) => (r.method === 'POST' ? json({}, 403) : undefined);
  await ctx.scene();
  ctx.api.handler = (r) => (r.method === 'GET' ? json({}, 403) : undefined);
  const blocked = await ctx.gladys.fake.action('check_account', {});
  assert.match(blocked.data.message.en, /already refused it/);
  ctx.api.handler = undefined;
  const lifted = await ctx.gladys.fake.action('check_account', {});
  assert.match(lifted.data.message.en, /accepted the key/);
  assert.equal((await ctx.scene()).success, true, 'lifted by a success of the button');
  await ctx.app.stop();
});

test('one request in flight; a queue of 10 at most; a job whose time is over sends nothing', async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const ctx = await setup({
    handler: async () => {
      await gate;
      return undefined;
    },
  });
  const acks = [];
  for (let i = 0; i < 11; i += 1) acks.push(ctx.scene({ ...FIELDS, text: `t${i}` }));
  await ctx.clock.advance(0);
  assert.equal(ctx.api.requests.length, 1);
  assert.match((await acks[10]).error, /too many translations waiting/);
  await ctx.clock.advance(20 * SECOND);
  release();
  const results = await Promise.all(acks.slice(0, 10));
  await ctx.app.idle();
  assert.equal(ctx.api.peak, 1);
  assert.equal(results[0].success, true);
  assert.ok(results.slice(1).every((a) => /no time left/.test(a.error)));
  assert.equal(ctx.api.requests.length, 1);
  assert.equal(counted(ctx.store), 2, 'only the one sent is counted');
  await ctx.app.stop();
});

test('a configuration changed while a job waits is applied to it', async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const ctx = await setup({
    handler: async () => {
      await gate;
      return undefined;
    },
  });
  const first = ctx.scene();
  await ctx.clock.advance(0);
  const second = ctx.scene({ ...FIELDS, text: 'a'.repeat(20) });
  await ctx.clock.advance(0);
  await ctx.gladys.fake.configUpdated({ api_key: KEY, max_chars_per_call: 10 });
  release();
  assert.equal((await first).success, true);
  assert.match((await second).error, /longer than the maximum/);
  const third = ctx.scene({ ...FIELDS, text: 'short' });
  await ctx.gladys.fake.configUpdated({ api_key: '' });
  assert.match((await third).error, /no API key/);
  assert.equal(ctx.api.requests.length, 1);
  await ctx.app.stop();
});

test('getConfig failing in connected: retried, spaced, without end, then the module works', async () => {
  let fail = 3;
  let sdkRead = true;
  const ctx = await setup({
    start: false,
    getConfig: async () => {
      // The first read of each connect() is the SDK's own.
      if (sdkRead) {
        sdkRead = false;
        return BASE_CONFIG;
      }
      if (fail > 0) {
        fail -= 1;
        throw new Error('boom');
      }
      return BASE_CONFIG;
    },
  });
  await ctx.gladys.connect();
  await ctx.wait(0);
  assert.match(status(ctx.gladys).message.en, /could not be read from Gladys: new try in 5 s/);
  await ctx.wait(5 * SECOND);
  assert.match(status(ctx.gladys).message.en, /new try in 10 s/);
  await ctx.wait(10 * SECOND);
  await ctx.wait(30 * SECOND);
  assert.equal(status(ctx.gladys).connected, true);
  // Failing again on a reconnection keeps the last configuration.
  fail = 1;
  sdkRead = true;
  await ctx.gladys.disconnect();
  await ctx.gladys.connect();
  await ctx.wait(0);
  assert.equal(status(ctx.gladys).connected, true);
  assert.equal((await ctx.scene()).success, true);
  await ctx.wait(6 * SECOND);
  assert.equal(ctx.api.requests.length, 1);
  await ctx.app.stop();
});

test('no key or an unreadable key: said in the status, nothing sent', async () => {
  for (const [config, re] of [
    [{}, /Type the DeepL API key/],
    [{ api_key: 'has space inside' }, /characters DeepL keys never have/],
  ]) {
    const ctx = await setup({ config });
    assert.match(status(ctx.gladys).message.en, re);
    assert.equal((await ctx.scene()).success, false);
    assert.equal(
      (await ctx.gladys.fake.action('check_account', {})).data.message.en.startsWith('Not checked'),
      true,
    );
    assert.equal(ctx.api.requests.length, 0);
    await ctx.app.stop();
  }
});

test('after stop: no request, no timer', async () => {
  const ctx = await setup({ handler: () => json({}, 500) });
  await ctx.scene();
  await ctx.app.stop();
  assert.equal(ctx.clock.pending, 0, 'every timer cleared');
  await ctx.wait(HOUR);
  assert.equal(ctx.api.requests.length, 1);
});

test('the refused-key mark is 8 bits of a salted HMAC', () => {
  const salt = 'a'.repeat(32);
  assert.match(keyMark(salt, KEY), /^[0-9a-f]{2}$/);
  assert.notEqual(keyMark(salt, KEY), keyMark('b'.repeat(32), KEY));
  assert.ok(App);
});

test('a job left with less time than a request needs sends nothing (checked before the save)', async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const ctx = await setup({
    handler: async () => {
      await gate;
      return undefined;
    },
  });
  const first = ctx.scene();
  await ctx.clock.advance(0);
  const second = ctx.scene({ ...FIELDS, text: 'second' });
  await ctx.clock.advance(0);
  // 12 s of the 25 s budget spent waiting: 13 s left, under the 13.5 s a
  // request needs (save, request, margin).
  await ctx.clock.advance(12 * SECOND);
  release();
  assert.equal((await first).success, true);
  assert.match((await second).error, /no time left/);
  assert.equal(ctx.api.requests.length, 1);
  assert.equal(counted(ctx.store), LEN);
  await ctx.app.stop();
});

test('checks that need no queue answer before it: unreadable /data, text too long', async () => {
  const broken = createMemoryStore({ calls: [] });
  broken.unreadable = true;
  const ctx = await setup({ store: broken, config: { ...BASE_CONFIG, max_chars_per_call: 10 } });
  let queued = 0;
  const original = ctx.app.translateOne.bind(ctx.app);
  ctx.app.translateOne = (job) => {
    queued += 1;
    return original(job);
  };
  assert.match((await ctx.scene({ ...FIELDS, text: 'short' })).error, /unreadable/);
  assert.match((await ctx.scene()).error, /longer than the maximum/);
  assert.equal(queued, 0, 'refused without waiting for a turn');
  await ctx.app.stop();
});

test('a new key with the same 8-bit mark as the refused one is still tried', async () => {
  const store = createMemoryStore();
  const ctx = await setup({ store, handler: () => json({}, 403) });
  await ctx.scene();
  const { salt, refused } = store.data;
  assert.match(refused, /^[0-9a-f]{2}$/, 'the key is marked');
  let twin;
  for (let i = 0; !twin && i < 100_000; i += 1) {
    const candidate = `twin-key-${i}-0123456789`;
    if (keyMark(salt, candidate) === refused) twin = candidate;
  }
  assert.ok(twin, 'a key with the same mark');
  ctx.api.handler = undefined;
  await ctx.gladys.fake.configUpdated({ api_key: twin });
  assert.equal((await ctx.scene()).success, true);
  assert.equal(ctx.api.requests.at(-1).headers.Authorization, `DeepL-Auth-Key ${twin}`);
  await ctx.app.stop();
});

// --- Review r1 ----------------------------------------------------------------------

test('a 429 answered during stop(): the pause is kept, no timer outlives the app', async () => {
  for (const viaButton of [false, true]) {
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const store = createMemoryStore();
    const ctx = await setup({
      store,
      handler: async () => {
        await gate;
        return json({}, 429, { 'retry-after': '99999' });
      },
    });
    const pending = viaButton ? ctx.gladys.fake.action('check_account', {}) : ctx.scene();
    await ctx.clock.advance(0);
    assert.equal(ctx.api.requests.length, 1);
    const stopped = ctx.app.stop();
    release();
    await stopped;
    await pending;
    assert.equal(ctx.clock.pending, 0, `${viaButton ? 'button' : 'scene'}: no timer after stop`);
    assert.equal(ctx.app.pauseTimer, undefined);
    assert.ok(ctx.app.pause.untilMono > ctx.clock.monotonic(), 'the pause itself is kept');
  }
});

test('stop() during the save of the count: nothing leaves, the count is given back', async () => {
  const store = createMemoryStore();
  const ctx = await setup({ store });
  const save = store.save;
  let saving = 0;
  store.save = (data) => {
    saving += 1;
    return new Promise((resolve) =>
      ctx.clock.timers.setTimeout(() => save(data).then(resolve), 1000),
    );
  };
  const pending = ctx.scene();
  for (let i = 0; i < 50 && !saving; i += 1) await ctx.clock.advance(0);
  assert.equal(saving, 1, 'the count is being saved');
  const stopped = ctx.app.stop();
  for (let i = 0; i < 10; i += 1) await ctx.clock.advance(2000);
  await stopped;
  const ack = await pending;
  assert.match(ack.error, /integration stopped/);
  assert.equal(ctx.api.requests.length, 0);
  assert.equal(counted(store), 0, 'given back');
});

test('a 429 with a short Retry-After still pauses 60 s at least', async () => {
  const ctx = await setup({ handler: () => json({}, 429, { 'retry-after': '5' }) });
  await ctx.scene();
  ctx.api.handler = undefined;
  await ctx.wait(30 * SECOND);
  assert.match((await ctx.scene()).error, /pause/);
  await ctx.wait(31 * SECOND);
  assert.equal((await ctx.scene()).success, true);
  await ctx.app.stop();
});

test('a 5xx with a Retry-After pauses that long (bounded), more than 60 s', async () => {
  const ctx = await setup({ handler: () => json({}, 503, { 'retry-after': '600' }) });
  await ctx.scene();
  ctx.api.handler = undefined;
  await ctx.wait(9 * MINUTE);
  assert.match((await ctx.scene()).error, /pause/);
  await ctx.wait(MINUTE + SECOND);
  assert.equal((await ctx.scene()).success, true);
  await ctx.app.stop();
});

test('beyond 1,000 entries the oldest are merged, never lost', async () => {
  const calls = Array.from({ length: 1000 }, (_, i) => ({ wall: NOW - HOUR + i, chars: 5 }));
  const store = createMemoryStore({ calls });
  const ctx = await setup({ store, config: { ...BASE_CONFIG, max_chars_per_day: 100000 } });
  assert.equal((await ctx.scene()).success, true);
  assert.equal(callsOf(store).length, 1000);
  assert.equal(counted(store), 5000 + LEN);
  await ctx.app.stop();
});

test('an unreadable /data is never written: not by the button, nor by a new key', async () => {
  const broken = createMemoryStore({ calls: [{ wall: NOW, chars: 9000 }] });
  broken.unreadable = true;
  const ctx = await setup({ store: broken });
  await ctx.gladys.fake.action('check_account', {});
  ctx.api.handler = () => json({}, 429);
  await ctx.gladys.fake.action('check_account', {});
  await ctx.gladys.fake.configUpdated({ api_key: PRO_KEY });
  await ctx.wait(SECOND);
  assert.equal(broken.saves, 0);
  assert.deepEqual(broken.data, { calls: [{ wall: NOW, chars: 9000 }] });
  await ctx.app.stop();
});

test('the button: refused when it could no longer answer in time, and during a pause', async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const ctx = await setup({
    handler: async (r) => {
      if (r.method === 'POST') await gate;
      return undefined;
    },
  });
  const first = ctx.scene();
  await ctx.clock.advance(0);
  const button = ctx.gladys.fake.action('check_account', {});
  await ctx.clock.advance(0);
  assert.equal(ctx.api.requests.length, 1, 'the button waits for its turn');
  await ctx.clock.advance(9 * SECOND);
  release();
  await first;
  assert.match((await button).data.message.en, /^Not checked: no time left/);
  assert.equal(ctx.api.requests.length, 1, 'no GET sent too late');
  ctx.api.handler = () => json({}, 500);
  await ctx.scene();
  ctx.api.handler = undefined;
  const paused = await ctx.gladys.fake.action('check_account', {});
  assert.match(paused.data.message.en, /^Not checked: DeepL asked for a pause/);
  assert.equal(ctx.api.requests.length, 2);
  await ctx.app.stop();
});

test('the queue counter comes back: 15 translations in a row all leave', async () => {
  const ctx = await setup();
  for (let i = 0; i < 15; i += 1) assert.equal((await ctx.scene()).success, true, `#${i}`);
  await ctx.app.stop();
});

test('a /data date in the future stays as written (not rewritten to the current wall time)', async () => {
  const store = createMemoryStore({ calls: [{ wall: NOW + 2 * HOUR, chars: 7 }] });
  const ctx = await setup({ store });
  await ctx.scene();
  assert.equal(callsOf(store)[0].wall, NOW + 2 * HOUR);
  await ctx.app.stop();
});

test('getConfig that never answers: a scene is refused within its bound', async () => {
  let sdkRead = true;
  const ctx = await setup({
    start: false,
    getConfig: () => {
      if (sdkRead) {
        sdkRead = false;
        return Promise.resolve(BASE_CONFIG);
      }
      return new Promise(() => {});
    },
  });
  ctx.gladys.connect(); // its "connected" handler waits for the config forever
  await ctx.clock.advance(0);
  const pending = ctx.scene();
  for (let i = 0; i < 5; i += 1) await ctx.clock.advance(SECOND);
  assert.match((await pending).error, /configuration is not read yet/);
  assert.equal(ctx.api.requests.length, 0);
  await ctx.app.stop();
});

test('a /data read that hangs counts as unreadable after 3 s', async () => {
  const store = createMemoryStore();
  store.load = () => new Promise(() => {});
  const ctx = await setup({ store, start: false });
  await ctx.gladys.connect();
  await ctx.clock.advance(3500);
  assert.match(status(ctx.gladys).message.en, /\/data is unreadable/);
  assert.match((await ctx.scene()).error, /unreadable/);
  await ctx.app.stop();
});

test('only a key ENDING in ":fx" goes to the Free host', async () => {
  const ctx = await setup({ config: { api_key: 'abcdefgh-1234:fx:x' } });
  await ctx.scene();
  assert.equal(ctx.api.requests[0].origin, 'https://api.deepl.com');
  await ctx.app.stop();
});

test('a 456 pause read back from /data is still told as a quota pause', async () => {
  const store = createMemoryStore({ pause: { until: NOW + HOUR, why: 'quota', streak: 1 } });
  const ctx = await setup({ store });
  assert.match((await ctx.scene()).error, /456/);
  assert.match(status(ctx.gladys).message.en, /456/);
  await ctx.app.stop();
});

test('a /data date years ahead is brought back to one window ahead at most', async () => {
  const store = createMemoryStore({ calls: [{ wall: NOW + 3650 * 24 * HOUR, chars: 7 }] });
  const ctx = await setup({ store });
  await ctx.scene();
  const [first] = callsOf(store);
  assert.ok(
    first.wall <= NOW + 25 * HOUR && first.wall >= NOW + 23 * HOUR,
    String(first.wall - NOW),
  );
  await ctx.app.stop();
});

test('a job still queued at stop() is refused before its count is even written', async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const store = createMemoryStore();
  const ctx = await setup({
    store,
    handler: async () => {
      await gate;
      return undefined;
    },
  });
  const totals = [];
  const save = store.save;
  store.save = (data) => {
    totals.push(data.calls.reduce((s, c) => s + c.chars, 0));
    return save(data);
  };
  const first = ctx.scene();
  await ctx.clock.advance(0);
  const second = ctx.scene({ ...FIELDS, text: 'b'.repeat(777) });
  await ctx.clock.advance(0);
  const stopped = ctx.app.stop();
  release();
  await stopped;
  assert.equal((await first).success, true);
  assert.match((await second).error, /integration stopped/);
  assert.equal(ctx.api.requests.length, 1);
  assert.ok(
    totals.every((t) => t < 777),
    `the queued text never reached /data (${totals.join(', ')})`,
  );
});
