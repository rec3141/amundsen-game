# Canadian French game interface

The expedition shell, ship and fleet controls, stores, log, CTD and ice notebooks,
and every crew minigame support English and Canadian French. The selected
`editorial-fr-ca-v2` profile supplies 1,561 source messages. The `crew-merge-fr-ca` override profile
adds 23 labels for the merged fleet, ice-coverage, ROV and learning controls.
New narrative strings outside those catalogs fall back to English. The original
68-message `editorial-fr-ca-v1` CTD pilot remains available as an independent,
immutable candidate.

## Catalogs and translator variants

- `locales/en.json`: stable source keys and English text.
- `locales/variants/<locale>/<profile>.json`: independent translator candidates,
  each retaining exact English source text and review status.
- `locales/selection.json`: one default profile per locale and optional per-key
  overrides; replacing a translator does not delete previous candidates.
- `python3 tools/build-ui-catalog.py`: compile selected variants and the
  standalone English fallback; `--check` verifies checked-in outputs.

Missing or stale source variants fall back to English; mismatched placeholders
fail compilation. Catalog provenance records the selected profile and source
SHA-256. Review status is metadata; selection is explicit and is not an
automatic quality gate.

The standalone runtime uses `?lang=en|fr-CA`, JSON local-storage key
`uw:locale`, and `uw:localechange` events. The dashboard and game share the
preference on the same origin. Browser auto-detection is intentionally off;
English is the fallback. Exact source messages and parameterized source
patterns can repaint text-only DOM content without rebuilding a game. Canvas
games explicitly rerender their labels on a locale change.

Translated markup is never injected as HTML. Scientific values, source data,
units, keyboard codes, game mechanics, saved field names and scoring remain
unchanged. Switching locale while an operation is open preserves its state and
one-award guard. Human-readable log titles are saved in the language used when
an operation finishes; historical log entries are not rewritten.

## Verification and publishing

Run `python3 tools/build-ui-catalog.py --check`, the existing Node/Python checks,
and a browser smoke in both locales. No localization-specific automated test
files are added. Deploy from committed source. The ship publisher exports its
local HEAD every five minutes; pull the updated main branch aboard before
publishing or a manual public deployment may be overwritten by the next export.
