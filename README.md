# DeepL for Gladys Assistant

Unofficial [Gladys Assistant](https://gladysassistant.com) integration, not
affiliated with DeepL: a **"Translate (DeepL)"** scene action that translates
a text with your own DeepL API key (Free or Pro) and gives the translation to
the next actions of the scene.

- Free keys (ending in `:fx`) go to `api-free.deepl.com`, Pro keys to
  `api.deepl.com`; DeepL is called only by the scene action and the "Check the
  key" button.
- Two caps in the module: characters per translation (a longer text is
  refused, never cut) and over a rolling 24 hours, counted and saved in
  `/data` before each request, kept across a restart.
- A translation that may have been counted (timeout, cut connection, 5xx) is
  never tried again; pauses after a 429, a 456 (quota) or a 5xx.
- The text, the translation and the key never reach the logs, the status nor
  `/data`.
- Never tested with a real DeepL key yet.

User guide: [English](docs/en.md) · [Français](docs/fr.md).

## Requirements

Gladys Assistant 5.1 or later (scene actions), a DeepL API account
([deepl.com/pro-api](https://www.deepl.com/pro-api)). DeepL API Pro is billed
per character: set the caps accordingly.

## Development

```bash
npm install
npm test             # node --test
npm run lint
npm run format:check
```

Node 22 or later, ESM, no build step. The only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).
See `CLAUDE.md` for the architecture and the rules, `TODO.md` for the
decisions and what remains to check.

## Licence

Apache-2.0 (see `LICENSE` and `THIRD_PARTY_NOTICES.md`). "DeepL" is a name of
its owner, used only to say which service is called.
