// -----------------------------------------------------------------------------
// The integration: translates a text through DeepL when a scene reaches the
// "Translate (DeepL)" action, and calls DeepL at no other time except the
// "Check the key" button (no polling, nothing at start, nothing on a
// configuration change).
//
// Guards, in the order a translation meets them:
//   - the text: not empty, at most `max_chars_per_call` characters (refused,
//     never cut: a cut translation would say something else);
//   - one request in flight at a time (a queue of 10 at most, each job with
//     its own deadline: a job whose time is over sends nothing);
//   - a pause after a 429/529 (Retry-After, bounded 60 s to 6 h), a 5xx (60 s,
//     doubled on repeat, 6 h at most) or a 456 (quota used up: 1 h at least),
//     kept in /data;
//   - a refused key (403 of the translation) is never sent again by a scene:
//     its 8-bit salted fingerprint is kept in /data, lifted by a new key or a
//     success of the check button;
//   - the daily cap: the characters counted over the last 24 hours plus this
//     text must not pass `max_chars_per_day`. A text is counted and the count
//     SAVED in /data before its request leaves (no save, no request), and
//     given back only when DeepL surely did not take it;
//   - a translation that may have been counted (timeout, connection cut, 5xx)
//     is never tried again: a second try could be billed twice.
//
// The text and the translation never reach a log, the status nor /data.
// Clocks: `monotonic` decides (cap window, pause, deadlines); `now` (wall)
// only dates /data.
// -----------------------------------------------------------------------------

import { createHmac, randomBytes } from 'node:crypto';
import {
  BUTTON_BUDGET,
  CAP_WINDOW,
  FORMALITIES,
  HTTP_TIMEOUT,
  LOAD_TIMEOUT,
  MAX_CALLS_KEPT,
  MAX_OUTPUT,
  MAX_QUEUE,
  PAUSE_MAX,
  PAUSE_MIN,
  QUOTA_PAUSE,
  SAVE_TIMEOUT,
  SCENE_BUDGET,
  SEND_MARGIN,
  SOURCES,
  STATUS_TIMEOUT,
  STORE_RETRY,
  TARGETS,
  TRANSLATE_PATH,
  USAGE_PATH,
} from './constants.js';
import { apiBase, normalizeConfig } from './config.js';
import { DeeplError, request } from './http.js';
import { T, reasonMessage, sceneError } from './i18n.js';
import { countChars, cut } from './text.js';

const realTimers = { setTimeout, clearTimeout };
const CONFIG_RETRY = [5_000, 10_000, 30_000, 60_000, 300_000];
const TARGET_CODES = new Set(TARGETS.map(([code]) => code));
const SOURCE_CODES = new Set(SOURCES.map(([code]) => code));
const LANG = /^[A-Z]{2,3}(?:-[A-Z0-9]{2,4})?$/;

/** A refused translation: nothing left. `code` is a key of T.reason. */
export class NotSent extends Error {
  constructor(code) {
    super(code);
    this.name = 'NotSent';
    this.code = code;
  }
}

/** The 8-bit fingerprint of a key: enough to recognise it, never to find it back. */
export const keyMark = (salt, key) =>
  createHmac('sha256', salt).update(String(key)).digest('hex').slice(0, 2);

export class App {
  constructor({
    gladys,
    logger = console,
    now = Date.now,
    monotonic = () => performance.now(),
    timers = realTimers,
    store,
    fetchImpl = (...args) => globalThis.fetch(...args),
    random = (n) => randomBytes(n).toString('hex'),
  }) {
    Object.assign(this, { gladys, logger, now, monotonic, timers, store, fetchImpl, random });
    this.config = undefined;
    this.configTries = 0;
    this.configTimer = undefined;
    this.configReading = undefined;
    /** /data: undefined (not read yet), 'ok', 'missing' or 'unreadable'. */
    this.dataState = undefined;
    this.loading = undefined;
    this.loadTimer = undefined;
    this.storeTimer = undefined;
    this.saveFailed = false;
    this.salt = undefined;
    this.refusedMark = undefined;
    /** Characters counted for the daily cap: { mono, wall, chars }. */
    this.calls = [];
    this.pause = { untilMono: 0, untilWall: 0, why: undefined, streak: 0 };
    this.pauseTimer = undefined;
    this.queue = Promise.resolve();
    this.waiting = 0;
    this.running = false;
    this.generation = 0;
    this.lastStatus = undefined;
    this.statusJob = Promise.resolve();
  }

  // --- Life cycle ---------------------------------------------------------------

  async start() {
    this.running = true;
    const gen = (this.generation += 1);
    this.loadState();
    await this.readConfig(gen);
  }

  /** Every (re)connection: started once, then the config read again and the status re-sent. */
  async connected() {
    if (!this.running) return this.start();
    this.lastStatus = undefined;
    await this.readConfig(this.generation);
    this.publishStatus();
  }

  async stop() {
    this.running = false;
    this.generation += 1;
    for (const key of ['configTimer', 'loadTimer', 'storeTimer', 'pauseTimer']) {
      if (this[key]) this.timers.clearTimeout(this[key]);
      this[key] = undefined;
    }
    await this.idle();
  }

  /** Resolves when the queued jobs and the status are done (tests, stop). */
  async idle() {
    await this.queue;
    await this.statusJob;
  }

  // --- Configuration ------------------------------------------------------------

  /** Reads the configuration; on failure, again later, spaced, without end. */
  async readConfig(gen) {
    if (this.configReading) return this.configReading;
    this.configReading = (async () => {
      try {
        const raw = await this.gladys.getConfig();
        if (gen !== this.generation) return;
        this.applyConfig(raw);
      } catch (err) {
        if (gen !== this.generation) return;
        const delay = CONFIG_RETRY[Math.min(this.configTries, CONFIG_RETRY.length - 1)];
        this.configTries += 1;
        this.logger.warn(
          `Configuration not read (${err?.message ?? err}): new try in ${delay / 1000} s`,
        );
        if (!this.config)
          this.publishStatus({ connected: false, message: T.status.config_unread(delay / 1000) });
        if (this.configTimer) this.timers.clearTimeout(this.configTimer);
        this.configTimer = this.timers.setTimeout(() => {
          this.configTimer = undefined;
          if (this.running && gen === this.generation) this.readConfig(gen);
        }, delay);
      } finally {
        this.configReading = undefined;
      }
    })();
    return this.configReading;
  }

  applyConfig(raw) {
    this.config = normalizeConfig(raw ?? {});
    this.configTries = 0;
    if (this.configTimer) this.timers.clearTimeout(this.configTimer);
    this.configTimer = undefined;
    this.publishStatus();
  }

  /**
   * onConfigUpdated: nothing is sent, only the status changes. A key changed
   * during the run lifts the refusal: the new key is always tried (its 8-bit
   * mark could match the refused one by chance).
   */
  configUpdated(raw) {
    const before = this.config?.apiKey;
    this.applyConfig(raw);
    if (before !== undefined && before !== this.config.apiKey && this.refusedMark) {
      this.refusedMark = undefined;
      this.save();
      this.publishStatus();
    }
  }

  /** The config for a request: read once more (bounded) when not read yet. */
  async configForSend() {
    if (!this.config && this.running) {
      let timer;
      const late = new Promise((resolve) => {
        timer = this.timers.setTimeout(resolve, 3_000);
      });
      await Promise.race([this.readConfig(this.generation), late]);
      this.timers.clearTimeout(timer);
    }
    if (!this.config) throw new NotSent('config_unread');
    if (this.config.issues.includes('no_key')) throw new NotSent('no_key');
    if (this.config.issues.includes('bad_key')) throw new NotSent('bad_key');
    return this.config;
  }

  // --- /data ----------------------------------------------------------------------

  /**
   * One read at a time. A read that takes more than 3 s counts as unreadable
   * for now (its result is still applied if it ends); unreadable: read again
   * every 10 s.
   */
  loadState() {
    if (this.loading || this.dataState === 'ok' || this.dataState === 'missing') return;
    const gen = this.generation;
    this.loading = Promise.resolve()
      .then(() => this.store.load())
      .catch(() => ({ status: 'unreadable' }))
      .then((result) => {
        this.loading = undefined;
        if (this.loadTimer) this.timers.clearTimeout(this.loadTimer);
        this.loadTimer = undefined;
        if (gen !== this.generation || !this.running) return;
        this.restore(result);
      });
    if (this.loadTimer) this.timers.clearTimeout(this.loadTimer);
    this.loadTimer = this.timers.setTimeout(() => {
      this.loadTimer = undefined;
      if (this.loading && gen === this.generation && this.running) {
        this.restore({ status: 'unreadable' });
      }
    }, LOAD_TIMEOUT);
  }

  /** The next read of an unreadable /data, 10 s later (later again while one hangs). */
  retryLoad() {
    if (this.storeTimer || !this.running) return;
    this.storeTimer = this.timers.setTimeout(() => {
      this.storeTimer = undefined;
      if (!this.running) return;
      if (this.loading) this.retryLoad();
      else this.loadState();
    }, STORE_RETRY);
  }

  /**
   * Before a translation: /data read (the first read is bounded). An
   * unreadable /data refuses: the characters of the last 24 hours are unknown.
   */
  async dataForSend() {
    if (this.dataState === undefined && this.running) {
      let timer;
      const late = new Promise((resolve) => {
        timer = this.timers.setTimeout(resolve, LOAD_TIMEOUT + 100);
      });
      await Promise.race([this.loading ?? Promise.resolve(), late]);
      this.timers.clearTimeout(timer);
    }
    if (this.dataState === undefined) throw new NotSent('data_pending');
    if (this.dataState === 'unreadable') throw new NotSent('data_unreadable');
  }

  restore(result) {
    if (result.status === 'unreadable') {
      if (this.dataState !== 'unreadable')
        this.logger.warn('/data is unreadable or too slow: read again every 10 s');
      this.dataState = 'unreadable';
      this.publishStatus();
      this.retryLoad();
      return;
    }
    const data = result.status === 'ok' ? result.data : {};
    const wall = this.now();
    const mono = this.monotonic();
    // The characters of the last 24 hours. A time in the future (a wall clock
    // set back) is counted as now: the cap stays on the safe side.
    const kept = [];
    for (const item of Array.isArray(data.calls) ? data.calls.slice(-MAX_CALLS_KEPT) : []) {
      const chars = item?.chars;
      if (typeof item?.wall !== 'number' || !Number.isFinite(item.wall)) continue;
      if (!Number.isInteger(chars) || chars < 0 || chars > 10_000_000) continue;
      const age = Math.max(0, wall - item.wall);
      if (age >= CAP_WINDOW) continue;
      // A future wall date (a clock behind at boot) is kept as written, so the
      // entry lasts longer once the clock is right again, never shorter; at
      // most one window ahead, so a date years away cannot block forever.
      kept.push({ mono: mono - age, wall: Math.min(item.wall, wall + CAP_WINDOW), chars });
    }
    this.calls = [...kept, ...this.calls];
    this.trimCalls();
    // The pause: a remaining time bounded by the maximum.
    const until = data.pause?.until;
    if (typeof until === 'number' && Number.isFinite(until) && until > wall) {
      const left = Math.min(until - wall, PAUSE_MAX);
      const why = ['rate_limited', 'quota'].includes(data.pause.why) ? data.pause.why : 'server';
      if (mono + left > this.pause.untilMono) this.setPause(left, why, false);
    }
    const streak = data.pause?.streak;
    if (Number.isInteger(streak) && streak >= 0 && streak < 20) {
      this.pause.streak = Math.max(this.pause.streak, streak);
    }
    // The refused key: its mark under the salt of /data.
    if (typeof data.salt === 'string' && /^[0-9a-f]{32}$/.test(data.salt)) {
      this.salt = data.salt;
      this.refusedMark =
        typeof data.refused === 'string' && /^[0-9a-f]{2}$/.test(data.refused)
          ? data.refused
          : undefined;
    }
    this.dataState = result.status;
    this.publishStatus();
  }

  snapshot() {
    return {
      salt: this.salt,
      refused: this.refusedMark ?? null,
      pause:
        this.pause.untilMono > this.monotonic()
          ? { until: this.pause.untilWall, why: this.pause.why, streak: this.pause.streak }
          : { streak: this.pause.streak },
      calls: this.calls.map(({ wall, chars }) => ({ wall, chars })),
    };
  }

  /** Saves the state, bounded in time; never over an unreadable /data. Resolves true when saved. */
  async save() {
    if (this.dataState !== 'ok' && this.dataState !== 'missing') return false;
    if (!this.salt) this.salt = this.random(16);
    let timer;
    const late = new Promise((resolve) => {
      timer = this.timers.setTimeout(() => resolve('timeout'), SAVE_TIMEOUT);
    });
    try {
      const job = this.store.save(this.snapshot()).then(() => 'ok');
      job.catch(() => {});
      const outcome = await Promise.race([job, late]);
      if (outcome !== 'ok') this.logger.warn('/data not saved in time');
      else if (this.dataState === 'missing') this.dataState = 'ok';
      this.noteSave(outcome === 'ok');
      return outcome === 'ok';
    } catch (err) {
      this.logger.warn(`/data not saved: ${err?.code ?? err?.message ?? err}`);
      this.noteSave(false);
      return false;
    } finally {
      this.timers.clearTimeout(timer);
    }
  }

  noteSave(ok) {
    if (this.saveFailed === !ok) return;
    this.saveFailed = !ok;
    this.publishStatus();
  }

  // --- Guards -----------------------------------------------------------------------

  markRefused(key) {
    if (!this.salt) this.salt = this.random(16);
    this.refusedMark = keyMark(this.salt, key);
  }

  isRefused(key) {
    return Boolean(this.refusedMark && this.salt && keyMark(this.salt, key) === this.refusedMark);
  }

  /** A pause of `ms` (60 s to 6 h; a pause read back from /data keeps its remaining time). */
  setPause(ms, why, grow = true) {
    const delay = Math.min(PAUSE_MAX, Math.max(grow ? PAUSE_MIN : 1, ms));
    this.pause.untilMono = this.monotonic() + delay;
    this.pause.untilWall = this.now() + delay;
    this.pause.why = why;
    if (grow) this.pause.streak = Math.min(this.pause.streak + 1, 19);
    if (this.pauseTimer) this.timers.clearTimeout(this.pauseTimer);
    this.pauseTimer = undefined;
    // After stop() (a request answered during the shutdown) the pause is kept
    // in memory and in /data, but no timer outlives the app.
    if (!this.running) return;
    this.pauseTimer = this.timers.setTimeout(() => {
      this.pauseTimer = undefined;
      this.publishStatus();
    }, delay + 1);
  }

  paused(mono) {
    return mono < this.pause.untilMono;
  }

  /**
   * At most MAX_CALLS_KEPT entries: beyond, the two oldest are merged at the
   * date of the newer one (the cap then keeps them a little longer, never
   * shorter).
   */
  trimCalls() {
    while (this.calls.length > MAX_CALLS_KEPT) {
      const [a, b] = this.calls;
      this.calls.splice(0, 2, { mono: b.mono, wall: b.wall, chars: a.chars + b.chars });
    }
  }

  /** Characters counted in the 24 hours before `mono`. */
  used(mono) {
    this.calls = this.calls.filter((c) => mono - c.mono < CAP_WINDOW);
    return this.calls.reduce((sum, c) => sum + c.chars, 0);
  }

  // --- Translating ----------------------------------------------------------------------

  /** The fields of the scene action, checked; throws NotSent. */
  static readFields(fields, config) {
    const text = typeof fields.text === 'string' ? fields.text : '';
    if (!text.trim()) throw new NotSent('empty_text');
    const chars = countChars(text);
    if (chars > config.maxPerCall) throw new NotSent('too_long');
    const target = typeof fields.target_lang === 'string' ? fields.target_lang.trim() : '';
    if (!TARGET_CODES.has(target)) throw new NotSent('bad_target');
    const source = typeof fields.source_lang === 'string' ? fields.source_lang.trim() : '';
    if (source && !SOURCE_CODES.has(source)) throw new NotSent('bad_source');
    const formality = typeof fields.formality === 'string' ? fields.formality.trim() : '';
    if (formality && !FORMALITIES.includes(formality)) throw new NotSent('bad_formality');
    return { text, chars, target, source, formality };
  }

  /**
   * Translates the fields of the scene action. Resolves
   * `{ text, detected, billed, truncated }`; throws NotSent when nothing left,
   * or a NotSent with `maybe` when DeepL may have counted it.
   */
  async translate(fields = {}, budget = SCENE_BUDGET) {
    const deadline = this.monotonic() + budget;
    const config = await this.configForSend();
    const job = App.readFields(fields, config);
    await this.dataForSend();
    if (this.waiting >= MAX_QUEUE) throw new NotSent('queue_full');
    this.waiting += 1;
    const gen = this.generation;
    const run = this.queue.then(() => this.translateOne({ ...job, deadline, gen }));
    this.queue = run.catch(() => {});
    try {
      return await run;
    } finally {
      this.waiting -= 1;
    }
  }

  /** Why nothing may leave now, or undefined. The clock is read once. */
  blocked({ deadline, gen, chars }) {
    const mono = this.monotonic();
    if (!this.running || gen !== this.generation) return 'stopped';
    if (deadline - mono < SEND_MARGIN) return 'time';
    if (this.paused(mono)) return this.pause.why === 'quota' ? 'quota' : 'paused';
    // The configuration may have changed while the job waited for its turn.
    if (this.config.issues.length) return this.config.issues[0];
    if (chars > this.config.maxPerCall) return 'too_long';
    if (this.isRefused(this.config.apiKey)) return 'refused';
    if (this.dataState === 'unreadable') return 'data_unreadable';
    if (this.used(mono) + chars > this.config.maxPerDay) return 'cap';
    return undefined;
  }

  async translateOne({ text, chars, target, source, formality, deadline, gen }) {
    const why = this.blocked({ deadline, gen, chars });
    if (why) throw new NotSent(why);
    const config = this.config;
    const entry = { mono: this.monotonic(), wall: this.now(), chars };
    // Counted and saved before the request leaves: a crash after it cannot
    // free the characters. No save, no request.
    this.calls.push(entry);
    this.trimCalls();
    const saved = await this.save();
    if (!saved) {
      this.release(entry);
      throw new NotSent('data_unwritable');
    }
    if (!this.running || gen !== this.generation) {
      this.release(entry);
      await this.save();
      throw new NotSent('stopped');
    }
    if (deadline - this.monotonic() < SEND_MARGIN - SAVE_TIMEOUT) {
      this.release(entry);
      await this.save();
      throw new NotSent('time');
    }
    const body = { text: [text], target_lang: target, show_billed_characters: true };
    if (source) body.source_lang = source;
    if (formality && formality !== 'default') body.formality = formality;
    let json;
    try {
      ({ json } = await request(apiBase(config.apiKey), TRANSLATE_PATH, {
        apiKey: config.apiKey,
        body,
        fetchImpl: this.fetchImpl,
        now: this.now,
      }));
    } catch (err) {
      if (!(err instanceof DeeplError)) throw err;
      if (err.sent !== 'maybe') this.release(entry);
      this.onFailure(err, config);
      this.logger.warn(
        `Translation ${err.sent === 'maybe' ? 'may have been counted' : 'not sent'}: ${err.code}${err.status ? ` (${err.status})` : ''}`,
      );
      await this.save();
      this.publishStatus();
      const out = new NotSent(err.code);
      out.maybe = err.sent === 'maybe';
      throw out;
    }
    // Answered with a 2xx: DeepL counted it, whatever the body says.
    const item = json?.translations?.[0];
    const billed = item?.billed_characters;
    if (Number.isInteger(billed) && billed > entry.chars && billed <= 10_000_000) {
      entry.chars = billed;
    }
    this.pause.streak = 0;
    await this.save();
    this.publishStatus();
    if (typeof item?.text !== 'string') {
      this.logger.warn('DeepL answered 2xx without a readable translation (counted)');
      const out = new NotSent('unreadable');
      out.maybe = true;
      throw out;
    }
    const detected =
      typeof item.detected_source_language === 'string' && LANG.test(item.detected_source_language)
        ? item.detected_source_language
        : '';
    this.logger.info(`Translated ${chars} character(s) into ${target}`);
    const { text: translation, truncated } = cut(item.text, MAX_OUTPUT);
    return { text: translation, detected, billed: entry.chars, truncated };
  }

  release(entry) {
    const i = this.calls.indexOf(entry);
    if (i >= 0) this.calls.splice(i, 1);
  }

  /** What a failure changes for the next requests (pause, refusal). */
  onFailure(err, config) {
    if (err.code === 'refused') {
      this.markRefused(config.apiKey);
    } else if (err.code === 'rate_limited') {
      this.setPause(err.retryAfter ?? PAUSE_MIN * 2 ** this.pause.streak, 'rate_limited');
    } else if (err.code === 'server') {
      this.setPause(Math.max(err.retryAfter ?? 0, PAUSE_MIN * 2 ** this.pause.streak), 'server');
    } else if (err.code === 'quota') {
      this.setPause(Math.max(QUOTA_PAUSE, PAUSE_MIN * 2 ** this.pause.streak), 'quota');
    }
  }

  // --- Handlers -----------------------------------------------------------------------

  /** Scene action "translate": outputs, or an error for the scene log. */
  async sceneTranslate(fields = {}) {
    let out;
    try {
      out = await this.translate(fields, SCENE_BUDGET);
    } catch (err) {
      if (err instanceof NotSent) {
        throw sceneError(reasonMessage(err.code, err.maybe ? T.prefix.maybe : T.prefix.nothing));
      }
      throw err;
    }
    return {
      translation: out.text,
      detected_language: out.detected,
      characters: out.billed,
      truncated: out.truncated,
    };
  }

  /** Button "Check the key": GET /v2/usage, no character counted, in the queue. */
  async checkAccount() {
    const deadline = this.monotonic() + BUTTON_BUDGET;
    let config;
    try {
      config = await this.configForSend();
      if (this.waiting >= MAX_QUEUE) throw new NotSent('queue_full');
    } catch (err) {
      if (err instanceof NotSent) return reasonMessage(err.code, T.prefix.unchecked);
      throw err;
    }
    this.waiting += 1;
    const gen = this.generation;
    const job = this.queue.then(() => this.runCheck(config, gen, deadline));
    this.queue = job.catch(() => {});
    try {
      return await job;
    } finally {
      this.waiting -= 1;
    }
  }

  async runCheck(config, gen, deadline) {
    if (!this.running || gen !== this.generation)
      return reasonMessage('stopped', T.prefix.unchecked);
    const mono = this.monotonic();
    if (this.paused(mono))
      return reasonMessage(this.pause.why === 'quota' ? 'quota' : 'paused', T.prefix.unchecked);
    // Gladys gives up on the button after its timeout_seconds (20 s): a check
    // that could no longer answer in time is not sent.
    if (deadline - mono < HTTP_TIMEOUT) return reasonMessage('time', T.prefix.unchecked);
    const used = this.dataState === 'unreadable' ? undefined : this.used(mono);
    let message;
    try {
      const { json } = await request(apiBase(config.apiKey), USAGE_PATH, {
        apiKey: config.apiKey,
        fetchImpl: this.fetchImpl,
        now: this.now,
      });
      const count = json?.character_count;
      const limit = json?.character_limit;
      const usage =
        Number.isInteger(count) && count >= 0 && Number.isInteger(limit) && limit >= 0
          ? { count, limit }
          : undefined;
      this.refusedMark = undefined;
      this.pause.streak = 0;
      message = T.check.ok({ free: config.free, usage, used, cap: config.maxPerDay });
    } catch (err) {
      if (!(err instanceof DeeplError)) throw err;
      // A 403 of the usage route is not a refusal of the key for translating:
      // the next translation tells (rule of the secondary routes).
      if (err.code === 'refused')
        message = this.isRefused(config.apiKey) ? T.check.refused_blocked : T.check.refused;
      else {
        this.onFailure(err, config);
        message = reasonMessage(err.code, T.prefix.unchecked);
      }
    }
    await this.save();
    this.publishStatus();
    return message;
  }

  // --- Status -------------------------------------------------------------------------

  currentStatus() {
    const c = this.config;
    if (!c) return undefined;
    if (c.issues.includes('no_key')) return { connected: false, message: T.status.no_key };
    if (c.issues.includes('bad_key')) return { connected: false, message: T.status.bad_key };
    if (this.isRefused(c.apiKey)) return { connected: false, message: T.status.refused };
    const mono = this.monotonic();
    if (this.paused(mono)) {
      const minutes = Math.max(1, Math.ceil((this.pause.untilMono - mono) / 60_000));
      return { connected: false, message: T.status.paused(minutes, this.pause.why) };
    }
    if (this.dataState === 'unreadable')
      return { connected: false, message: T.status.data_unreadable };
    const message = { ...T.status.ready(c.free, c.maxPerCall, c.maxPerDay) };
    if (this.saveFailed) {
      message.en += T.status.data_unwritable.en;
      message.fr += T.status.data_unwritable.fr;
    }
    return { connected: true, message };
  }

  /** One status at a time, the same one never twice, bounded in time. */
  publishStatus(state = this.currentStatus()) {
    if (!state || !this.running) return;
    const gen = this.generation;
    this.statusJob = this.statusJob.then(async () => {
      if (gen !== this.generation) return;
      const key = JSON.stringify(state);
      if (key === this.lastStatus) return;
      let timer;
      const late = new Promise((resolve) => {
        timer = this.timers.setTimeout(() => resolve('timeout'), STATUS_TIMEOUT);
      });
      try {
        const sent = Promise.resolve(
          this.gladys.setConnectionStatus(state.connected, state.message),
        );
        sent.catch(() => {});
        if ((await Promise.race([sent.then(() => 'ok'), late])) === 'ok') this.lastStatus = key;
        else this.logger.warn('Status not published in time');
      } catch (err) {
        this.logger.warn(`Status not published: ${err?.message ?? err}`);
      } finally {
        this.timers.clearTimeout(timer);
      }
    });
  }
}
