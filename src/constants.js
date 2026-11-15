// -----------------------------------------------------------------------------
// Keys of the manifest, bounds and delays. The manifest keys are forever: a
// renamed key is a removed key for every scene and configuration using it.
// -----------------------------------------------------------------------------

export const VERSION = '0.1.0';
export const USER_AGENT = `gladys-deepl/${VERSION} (+https://github.com/LM1LC3N7/gladys-deepl)`;

/**
 * The DeepL API (https://developers.deepl.com/api-reference/translate, read on
 * 2026-11-15). A key ending in ":fx" is a DeepL API Free key and is served by
 * api-free.deepl.com; any other key by api.deepl.com (DeepL API Pro).
 */
export const API_FREE = 'https://api-free.deepl.com';
export const API_PRO = 'https://api.deepl.com';
export const TRANSLATE_PATH = '/v2/translate';
export const USAGE_PATH = '/v2/usage';

export const CONFIG = {
  API_KEY: 'api_key',
  MAX_PER_CALL: 'max_chars_per_call',
  MAX_PER_DAY: 'max_chars_per_day',
};

export const ACTIONS = { CHECK: 'check_account' };
export const SCENE_ACTION = 'translate';

/** Defaults, mirrored by the manifest (test/manifest.test.js ties them). */
export const DEFAULTS = {
  [CONFIG.MAX_PER_CALL]: 1000,
  [CONFIG.MAX_PER_DAY]: 10000,
};
/** Integer bounds [min, max] of the numeric options. */
export const BOUNDS = {
  [CONFIG.MAX_PER_CALL]: [1, 5000],
  [CONFIG.MAX_PER_DAY]: [100, 1000000],
};

/** The window of the daily cap: a rolling 24 hours, in ms. */
export const CAP_WINDOW = 24 * 60 * 60_000;

/**
 * Target languages of DeepL (GET /v2/languages?type=target, documentation of
 * 2026-11). The value is sent as is.
 */
export const TARGETS = [
  ['AR', 'Arabic', 'Arabe'],
  ['BG', 'Bulgarian', 'Bulgare'],
  ['CS', 'Czech', 'Tchèque'],
  ['DA', 'Danish', 'Danois'],
  ['DE', 'German', 'Allemand'],
  ['EL', 'Greek', 'Grec'],
  ['EN-GB', 'English (British)', 'Anglais (britannique)'],
  ['EN-US', 'English (American)', 'Anglais (américain)'],
  ['ES', 'Spanish', 'Espagnol'],
  ['ES-419', 'Spanish (Latin American)', 'Espagnol (Amérique latine)'],
  ['ET', 'Estonian', 'Estonien'],
  ['FI', 'Finnish', 'Finnois'],
  ['FR', 'French', 'Français'],
  ['HU', 'Hungarian', 'Hongrois'],
  ['ID', 'Indonesian', 'Indonésien'],
  ['IT', 'Italian', 'Italien'],
  ['JA', 'Japanese', 'Japonais'],
  ['KO', 'Korean', 'Coréen'],
  ['LT', 'Lithuanian', 'Lituanien'],
  ['LV', 'Latvian', 'Letton'],
  ['NB', 'Norwegian (Bokmål)', 'Norvégien (bokmål)'],
  ['NL', 'Dutch', 'Néerlandais'],
  ['PL', 'Polish', 'Polonais'],
  ['PT-BR', 'Portuguese (Brazilian)', 'Portugais (brésilien)'],
  ['PT-PT', 'Portuguese (European)', 'Portugais (européen)'],
  ['RO', 'Romanian', 'Roumain'],
  ['RU', 'Russian', 'Russe'],
  ['SK', 'Slovak', 'Slovaque'],
  ['SL', 'Slovenian', 'Slovène'],
  ['SV', 'Swedish', 'Suédois'],
  ['TR', 'Turkish', 'Turc'],
  ['UK', 'Ukrainian', 'Ukrainien'],
  ['ZH-HANS', 'Chinese (simplified)', 'Chinois (simplifié)'],
  ['ZH-HANT', 'Chinese (traditional)', 'Chinois (traditionnel)'],
];

/** Source languages (GET /v2/languages?type=source): no regional variant. */
export const SOURCES = [
  ...new Map(
    TARGETS.map(([code, en, fr]) => {
      const base = code.split('-')[0];
      return [base, [base, en.replace(/ \(.*\)$/, ''), fr.replace(/ \(.*\)$/, '')]];
    }),
  ).values(),
];

/** Formality: the "prefer_" values never fail on a language without formality. */
export const FORMALITIES = ['default', 'prefer_more', 'prefer_less'];

/** The outputs of the scene action are strings capped by Gladys at 10,000 characters. */
export const MAX_OUTPUT = 10_000;

/** One request, from the first byte to the last byte of the answer. */
export const HTTP_TIMEOUT = 10_000;
/** A translation of 5,000 characters stays far below this; anything larger is cut. */
export const MAX_ANSWER_BYTES = 256 * 1024;
/**
 * Scene action budget: the manifest's timeout_seconds (45 s) counts from the
 * moment the scene reaches the action, Gladys' own wait for the connection
 * (up to 15 s) included: 25 s here leave that room.
 */
export const SCENE_BUDGET = 25_000;
/**
 * Button budget, from the click: under the manifest's timeout_seconds (20 s),
 * the request (10 s at most) included.
 */
export const BUTTON_BUDGET = 18_000;
/** Translations in the queue, the one in flight included (one request at a time). */
export const MAX_QUEUE = 10;

/** Pause after a 429/529 or a 5xx: Retry-After when given, bounded, growing on repeat. */
export const PAUSE_MIN = 60_000;
export const PAUSE_MAX = 6 * 60 * 60_000;
/** Pause after a 456 (the DeepL quota of the account is used up). */
export const QUOTA_PAUSE = 60 * 60_000;

/** /data: a read taking longer counts as unreadable (read again every 10 s). */
export const LOAD_TIMEOUT = 3_000;
export const STORE_RETRY = 10_000;
export const SAVE_TIMEOUT = 3_000;
export const STATUS_TIMEOUT = 4_000;
export const MAX_STATE_BYTES = 64 * 1024;
/** Translations remembered for the daily cap (beyond, the oldest are merged). */
export const MAX_CALLS_KEPT = 1000;

/** What a request needs before the deadline: the save before it, the request, a margin. */
export const SEND_MARGIN = HTTP_TIMEOUT + SAVE_TIMEOUT + 500;
