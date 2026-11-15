// -----------------------------------------------------------------------------
// The app against the SDK's fake Gladys, a scripted DeepL API and a virtual
// clock (each read moves it 1 µs).
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { App } from '../../src/app.js';
import { ACTIONS, API_FREE, API_PRO, SCENE_ACTION } from '../../src/constants.js';
import { createMemoryStore } from '../../src/store.js';
import { testClock } from './clock.js';

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const NOW = Date.parse('2026-11-15T09:00:00Z');
export const KEY = '00000000-1111-4222-8333-SECRETKEY999:fx';
export const PRO_KEY = '00000000-1111-4222-8333-PROSECRET777';
export const TEXT = 'Le portail est resté ouvert PRIVATE-TEXT';

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/** A translation answer, billed as DeepL would (code points of the text). */
export const translated = (
  text = 'The gate stayed open PRIVATE-TRANSLATION',
  billed,
  lang = 'FR',
) =>
  json({
    translations: [
      {
        detected_source_language: lang,
        text,
        ...(billed === undefined ? {} : { billed_characters: billed }),
      },
    ],
  });

/** A fetch failure like undici's: `code` on the cause, or a timeout. */
export function fetchError(kind) {
  if (kind === 'timeout') {
    const err = new Error('The operation was aborted due to timeout');
    err.name = 'TimeoutError';
    return err;
  }
  const err = new TypeError('fetch failed');
  err.cause = Object.assign(new Error(kind), { code: kind });
  return err;
}

/**
 * DeepL: `api.handler(request)` returns a Response, or a string naming a
 * failure ('timeout', 'ECONNRESET', 'ENOTFOUND'…); none = translated.
 */
export function createApi() {
  const api = { requests: [], handler: undefined, inFlight: 0, peak: 0 };
  api.translations = () => api.requests.filter((r) => r.method === 'POST');
  api.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const request = {
      url: String(url),
      origin: u.origin,
      path: u.pathname,
      method: init.method,
      headers: init.headers ?? {},
      body: init.body ? JSON.parse(init.body) : undefined,
      init,
    };
    api.requests.push(request);
    api.inFlight += 1;
    api.peak = Math.max(api.peak, api.inFlight);
    try {
      if (u.origin !== API_FREE && u.origin !== API_PRO)
        return new Response('nope', { status: 404 });
      const out = api.handler ? await api.handler(request) : undefined;
      if (typeof out === 'string') throw fetchError(out);
      if (out instanceof Response) return out;
      if (request.method === 'POST') {
        const chars = [...request.body.text[0]].length;
        return translated(undefined, chars);
      }
      return json({ character_count: 1234, character_limit: 500000 });
    } finally {
      api.inFlight -= 1;
    }
  };
  return api;
}

export const BASE_CONFIG = { api_key: KEY };
export const FIELDS = { text: TEXT, target_lang: 'EN-US' };

export async function setup({
  config = BASE_CONFIG,
  store = createMemoryStore(),
  now = NOW,
  start = true,
  handler,
  getConfig,
  clock = testClock({ start: now }),
} = {}) {
  const gladys = createFakeGladys({ selector: 'deepl', config });
  if (getConfig) gladys.getConfig = getConfig;
  const api = createApi();
  api.handler = handler;
  const lines = [];
  const log = (...args) => lines.push(args.map(String).join(' '));
  let random = 0;
  const app = new App({
    gladys,
    logger: { info: log, warn: log, error: log, debug: log },
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    store,
    fetchImpl: api.fetch,
    random: (n) => String((random += 1)).padStart(n * 2, 'a'),
  });
  gladys.onSceneAction(SCENE_ACTION, (fields) => app.sceneTranslate(fields));
  gladys.onAction(ACTIONS.CHECK, () => app.checkAccount());
  gladys.onConfigUpdated((c) => app.configUpdated(c));
  gladys.on('connected', () => app.connected());
  const wait = async (ms) => {
    await clock.advance(ms);
    await app.idle();
  };
  if (start) {
    await gladys.connect();
    await wait(0);
  }
  /** The scene action, as Gladys runs it: resolves the ack. */
  const scene = (fields = FIELDS) => gladys.fake.sceneAction(SCENE_ACTION, fields);
  return { app, gladys, clock, store, api, wait, lines, scene };
}

/** Everything the module wrote outside the API: logs, statuses, /data. */
export function leaked({ lines, gladys, store }) {
  return [
    ...lines,
    JSON.stringify(gladys.fake.connectionStatuses),
    JSON.stringify(store.data ?? {}),
  ].join('\n');
}
