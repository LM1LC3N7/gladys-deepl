// -----------------------------------------------------------------------------
// The only network code: one HTTPS request to DeepL, with a timeout, the
// module's User-Agent, `Accept: application/json`, no redirect followed, and
// an answer read up to a bound.
//
// Every failure says whether DeepL may have counted the characters (`sent`):
//   - 'no'    : nothing was taken (a 4xx, a redirect, a name or connection
//               refused before the request left);
//   - 'maybe' : the request may have reached DeepL (a timeout, a connection
//               cut, a 5xx). Such a translation is never tried again: a second
//               try could be billed a second time.
// The API key travels in the Authorization header only; no message here ever
// contains it, nor the text, nor what DeepL answered word for word.
// -----------------------------------------------------------------------------

import { HTTP_TIMEOUT, MAX_ANSWER_BYTES, USER_AGENT } from './constants.js';

export class DeeplError extends Error {
  /**
   * `code`: 'refused' (403), 'unauthorized' (401: DeepL documents 403 for a
   * refused key, so a 401 is not taken as a refusal), 'quota' (456),
   * 'invalid' (400), 'request_too_large' (413, 414), 'rate_limited' (429,
   * 529), 'server' (5xx), 'http' (other status),
   * 'redirect', 'timeout', 'network', 'too_large'.
   */
  constructor(code, { status, sent = 'no', retryAfter } = {}) {
    super(status ? `DeepL answered ${status} (${code})` : `DeepL request failed (${code})`);
    this.name = 'DeeplError';
    this.code = code;
    this.status = status;
    this.sent = sent;
    this.retryAfter = retryAfter;
  }
}

/** Connection failures that happen before the request is written: nothing left. */
const BEFORE_SENDING =
  /^(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|EADDRNOTAVAIL|UND_ERR_CONNECT_TIMEOUT|ERR_TLS_|CERT_|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO_|ERR_SSL_)/;

/** Retry-After (seconds or an HTTP date) -> milliseconds, undefined when absent or invalid. */
export function retryAfterMs(value, now) {
  if (typeof value !== 'string' || value.length > 64) return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value) * 1000;
  if (!/^[A-Za-z]{3}, /.test(value)) return undefined;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

/** The body as text, refused past `limit` bytes (read in chunks, never whole). */
export async function readBounded(response, limit) {
  const tooLarge = () => new DeeplError('too_large', { status: response.status });
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel?.().catch(() => {});
    throw tooLarge();
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > limit) throw tooLarge();
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function failure(err, sentIfUnknown) {
  if (err instanceof DeeplError) return err;
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return new DeeplError('timeout', { sent: sentIfUnknown });
  }
  const code = String(err?.cause?.code ?? err?.code ?? '');
  return new DeeplError('network', { sent: BEFORE_SENDING.test(code) ? 'no' : sentIfUnknown });
}

/**
 * One request to `base` + `path`. Resolves `{ status, json }` (json undefined
 * when a 2xx body does not read); throws a DeeplError otherwise. A `body`
 * marks a translation: a failure whose outcome is unknown is then
 * `sent: 'maybe'`.
 */
export async function request(
  base,
  path,
  {
    apiKey,
    body,
    fetchImpl = globalThis.fetch,
    now = Date.now,
    timeout = HTTP_TIMEOUT,
    limit = MAX_ANSWER_BYTES,
  },
) {
  const post = body !== undefined;
  const unknown = post ? 'maybe' : 'no';
  const headers = {
    'User-Agent': USER_AGENT,
    Accept: 'application/json',
    Authorization: `DeepL-Auth-Key ${apiKey}`,
  };
  if (post) headers['Content-Type'] = 'application/json';
  const signal = AbortSignal.timeout(Math.max(1, timeout));
  let response;
  try {
    response = await fetchImpl(`${base}${path}`, {
      method: post ? 'POST' : 'GET',
      headers,
      body: post ? JSON.stringify(body) : undefined,
      signal,
      redirect: 'manual',
    });
  } catch (err) {
    throw failure(err, unknown);
  }
  const { status } = response;
  if (status >= 200 && status < 300) {
    // Answered: a body that does not read is told by the caller (json undefined).
    let json;
    try {
      json = JSON.parse(await readBounded(response, limit));
    } catch {
      json = undefined;
    }
    return { status, json };
  }
  // The error body is never read: its free text is not shown, and not needed.
  await response.body?.cancel?.().catch(() => {});
  if (status >= 300 && status < 400) throw new DeeplError('redirect', { status });
  if (status === 403) throw new DeeplError('refused', { status });
  if (status === 401) throw new DeeplError('unauthorized', { status });
  if (status === 456) throw new DeeplError('quota', { status });
  if (status === 413 || status === 414) throw new DeeplError('request_too_large', { status });
  if (status === 400) throw new DeeplError('invalid', { status });
  const served = Date.parse(response.headers?.get?.('date') ?? '');
  const retryAfter = () =>
    retryAfterMs(response.headers?.get?.('retry-after'), Number.isFinite(served) ? served : now());
  if (status === 429 || status === 529) {
    throw new DeeplError('rate_limited', { status, retryAfter: retryAfter() });
  }
  // A 5xx to a translation: DeepL may have counted it before failing.
  if (status >= 500) {
    throw new DeeplError('server', { status, sent: unknown, retryAfter: retryAfter() });
  }
  throw new DeeplError('http', { status });
}
