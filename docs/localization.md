# Canadian French pilot

The CTD notebook and its activity entry support English and Canadian French.
The rest of the expedition and other minigames remain English. Language pickers
are available in the page header and operation dialog. Changing language during
a cast preserves pressure, bottles, phase, score, and the one-award rule.

## Catalogs and translator variants

- `locales/en.json`: stable source keys and English text.
- `locales/variants/<locale>/<profile>.json`: independent translator candidates,
  each retaining exact English source text and review status.
- `locales/selection.json`: one default profile per locale and optional per-key
  overrides; replacing a translator does not delete previous candidates.
- `python3 tools/build-ui-catalog.py`: compile selected variants and the
  standalone English fallback; `--check` verifies checked-in outputs.

Missing or stale source variants fall back to English; mismatched placeholders
fail compilation. Catalog provenance records the profile and source SHA-256.
All 68 pilot keys have an editorial Canadian French candidate. This is a
lead-assistant translation, not output from the wiki's Gemma profile.
Review status is metadata; selection is explicit and is not an automatic
quality gate.

The runtime is a standalone copy of Underway's text-only localization runtime.
It uses `?lang=en|fr-CA`, JSON local storage key `uw:locale`, and
`uw:localechange` events. The dashboard and game share preferences on the same
origin. Browser auto-detection is intentionally off; English is the fallback.
No remote language service is required.

CTD display strings are translated separately from measurement channel keys.
Units, data files, scientific algorithms, keyboard codes and persisted score
payload fields stay unchanged. Human-readable log titles are saved in the
language used when a cast finishes; historical log entries are not rewritten.
Translated markup is escaped; fixed HTML structure remains in code.

## Verification and publishing

The existing `tests/test_ctd.mjs` checks pass under Node 22 (8 checks), including
bundled measurement validation and one award across repeat casts. An ad hoc
real-browser smoke also completed a cast with the actual bundled data, switched
French/English during ascent, checked pressure and score preservation, translated
the result, and verified cleanup. No new automated test files were added.

Deploy from committed source. The ship's publisher exports its local HEAD every
five minutes; GitHub changes alone do not update that checkout. Pull the updated
main branch aboard before publishing, or a manual public deployment may be
overwritten by the ship's next scheduled export. Keep targeted backups and
publish added dependencies before the changed HTML and game modules.
