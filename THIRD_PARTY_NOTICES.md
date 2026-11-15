# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). Its
code is its own: no third-party code is copied or ported.

## DeepL API

At run time the integration calls the DeepL API with the authentication key of
the user's own DeepL API account: `POST /v2/translate` to translate and
`GET /v2/usage` to read the characters used, on `https://api-free.deepl.com`
(DeepL API Free keys, ending in `:fx`) or `https://api.deepl.com` (DeepL API
Pro). The request and answer formats come from the public DeepL documentation
(`https://developers.deepl.com/api-reference/translate`, read on 2026-11-15);
nothing of it is shipped in this repository nor in the Docker image. Using the
API is subject to the DeepL terms of the user's account. "DeepL" is a name of
its owner, used here only to say which service is called.

The official client `deepl-node` (MIT) was considered and not used: the module
needs one request without retries, with a bounded answer, and the client would
add retries and several dependencies (see `TODO.md`, Decisions).

## Runtime dependency

- `@gladysassistant/integration-sdk` (Apache-2.0), the Gladys SDK.
