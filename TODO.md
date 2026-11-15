# TODO

## Before announcing

- [ ] Test with a real DeepL API Free key: the check button, a scene with the
      translation read by the next action, a 403 with a revoked key, the
      detected language.
- [ ] Test with a real DeepL API Pro key (api.deepl.com, `billed_characters`).
- [ ] Test on a real Gladys 5.3+: install, status, the scene action, its select
      fields and its outputs read by the next action, the button.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic to publish in the store
      (after the first release: the store validator needs the GHCR image).
- [ ] Store field left out of the manifest: `keywords` (DeepL, traduction,
      translation, langue, language).

## To confirm

- [ ] That `billed_characters` equals the code points of the text for plain
      text (the module counts code points before the request, and keeps the
      larger of the two).
- [ ] Whether DeepL answers 429 with a Retry-After (the module handles both).
- [ ] The `character_limit` DeepL gives a Pro account without a cost limit
      (a huge number is not shown).
- [ ] The target languages offered by the account (`GET /v2/languages`): the
      list in the manifest is the documented one of 2026-11; a language the
      account does not offer gets a 400, given back to the cap.

## Ideas

- A `context` field (not translated, not billed) for short texts.
- Glossaries, and `tag_handling` for HTML texts.
- A monthly cap on top of the daily one.

## Decisions

- **Version 0.1.0** set once by hand when leaving the template (package, lock
  file, manifest, image tag `ghcr.io/lm1lc3n7/gladys-deepl:0.1.0`, User-Agent
  in `src/constants.js`); the Release workflow owns it from now on.
- **`type: "provider"`, `gladys_version: ">=5.1.0"`, worldwide**: a scene
  action and a button, no device. SDK ^0.16.0, the latest on 2026-11-15.
- **No `deepl-node`** (MIT, 1.29.0 of 2026-11-02): it retries failed requests
  (a retry could bill a text twice), reads whole answers and brings several
  dependencies; one `fetch` with a timeout, a bounded body and no retry is
  enough here.
- **Two caps in the module**: per translation (1 to 5,000 characters, 1,000 by
  default: a longer text is refused, never cut) and over a rolling 24 hours
  (100 to 1,000,000, 10,000 by default). Characters are Unicode code points.
  A text is counted and the count saved in `/data` before its request leaves;
  no save, no request (a billed service: the count must survive a restart).
  Given back only when DeepL surely did not take it (4xx, redirect, DNS,
  refused connection, TLS). `billed_characters` raises the count, never lowers
  it.
- **No retry of a translation**, ever: a timeout, a cut connection or a 5xx
  may have been counted.
- **An unreadable `/data` refuses every translation** (the characters of the
  last 24 hours are unknown); it is read again every 10 s, never overwritten.
- **A refused key** (403 of `/v2/translate`) is kept as an 8-bit salted HMAC:
  a new key is always tried; lifted by a success of the check button. A 403 of
  `/v2/usage` alone marks nothing (rule of the secondary routes).
- **Pauses**: 429/529 Retry-After bounded 60 s to 6 h; 5xx 60 s doubled up to
  6 h; 456 (quota used up) 1 hour at least; kept in `/data`.
- **The Free host is chosen by the key** (`:fx` suffix, DeepL documentation);
  no option.
- **Formality** offers only `default`, `prefer_more` and `prefer_less`: the
  `prefer_` values never fail on a language without formality.
- **Outputs**: the translation is cut to the 10,000 characters Gladys keeps
  (`truncated` says so); an unexpected detected-language code is not relayed.
