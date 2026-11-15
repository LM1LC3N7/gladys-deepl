# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.1] - 2026-11-15

### Added

- The scene action "Translate (DeepL)": a text into one of the DeepL target
  languages, source detected or chosen, formality preferred; outputs
  `translation`, `detected_language`, `characters` and `truncated`.
- DeepL API Free (`:fx` keys, api-free.deepl.com) and Pro keys
  (api.deepl.com).
- The button "Check the key": DeepL's answer and the characters used this
  billing period, no character counted.
- A cap per translation (1 to 5,000 characters, 1,000 by default, a longer
  text refused) and over a rolling 24 hours (100 to 1,000,000, 10,000 by
  default), counted and saved in `/data` before each request.
- No second try of a translation that may have been counted (timeout, cut
  connection, 5xx); one request at a time; a pause after a 429/529
  (Retry-After, 60 s to 6 h), a 5xx (60 s, doubled, 6 h at most) or a 456
  (1 hour at least); a refused key (403) never used again by a scene until it
  changes or the button succeeds.
- The text, the translation and the key never written in a log, the status
  nor `/data`.
- A 401 shown as such (not taken as a refusal of the key), a 413 as a request
  size refused by DeepL; the Retry-After of a 5xx respected; the button
  refused when it could no longer answer in time; no timer left after stop.

[Unreleased]: https://github.com/LM1LC3N7/gladys-deepl/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-deepl/releases/tag/v0.1.1
