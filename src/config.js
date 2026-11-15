// -----------------------------------------------------------------------------
// The configuration typed in Gladys, read strictly. An option out of its
// bounds is brought back inside them; an empty or unreadable one takes its
// default. What is wrong is said by a code (`issues`), never by echoing the
// value.
// -----------------------------------------------------------------------------

import { API_FREE, API_PRO, BOUNDS, CONFIG, DEFAULTS } from './constants.js';

/** A strict integer option: '' or text = the default; a decimal refused; bounded. */
export function integerOption(raw, key) {
  const [min, max] = BOUNDS[key];
  let n;
  if (typeof raw === 'number') n = raw;
  else if (typeof raw === 'string' && /^\s*-?\d+\s*$/.test(raw)) n = Number(raw);
  if (!Number.isInteger(n)) return DEFAULTS[key];
  return Math.min(max, Math.max(min, n));
}

/** Printable ASCII only, 8 to 200 characters: a header value, never CR, LF, a space or a control. */
export const validKey = (key) => typeof key === 'string' && /^[\x21-\x7e]{8,200}$/.test(key);

/** DeepL API Free keys end with ":fx" (DeepL documentation); they have their own host. */
export const isFreeKey = (key) => typeof key === 'string' && key.endsWith(':fx');
export const apiBase = (key) => (isFreeKey(key) ? API_FREE : API_PRO);

export function normalizeConfig(raw = {}) {
  const issues = [];
  const apiKey = typeof raw[CONFIG.API_KEY] === 'string' ? raw[CONFIG.API_KEY].trim() : '';
  if (!apiKey) issues.push('no_key');
  else if (!validKey(apiKey)) issues.push('bad_key');
  const good = !issues.length;
  return {
    apiKey: good ? apiKey : '',
    free: good && isFreeKey(apiKey),
    maxPerCall: integerOption(raw[CONFIG.MAX_PER_CALL], CONFIG.MAX_PER_CALL),
    maxPerDay: integerOption(raw[CONFIG.MAX_PER_DAY], CONFIG.MAX_PER_DAY),
    issues,
  };
}
