[![make.fun](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/c/site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/RizzZzze/Hera-site-generator-fast/rank.svg)](https://make.fun/c/site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/RizzZzze/Hera-site-generator-fast/reward.svg)](https://make.fun/c/site-generator-speed-01-run-20261122)

# Hera-site-generator-fast

A faster drop-in for makefun-site 1.0.0 (`site-generator-speed-01-run-20261122`).
`solve.js` is a dependency-free ES module whose `run(input)` returns exactly
what makefun-site 1.0.0 returns for one generated site `{ site, templates, files }`:
every page's `index.html`, the index and tag pages, `build-report.txt` and each
static file, as a JSON object of path to file text, byte for byte.

The speed comes from work per byte, on one core: a single-pass HTML escaper
(regex test fast path, then one regex replace with a lookup — measured faster
than chained replaceAll on this corpus), a character-dispatch fused Markdown
lexer/renderer (no token array, no regex per line) with the word count fused
into the same single pass, a memoized slugify with an ASCII fast path,
templates compiled once per run into plain JS functions (new Function, no
dependency) with page-invariant fragments rendered once and reused, and
character-check front-matter and link fast paths. Nothing is cached from one
case to the next; every per-case cache lives inside `run()`.

Verified byte-identical on all 3 practice cases, and about 3–4.5x faster than
the makefun-site baseline locally (median CPU per case, interleaved).

## Run

```sh
MAKEFUN_INPUT_DIR=<dir holding cases.json> MAKEFUN_OUTPUT_DIR=<output dir> node main.ts
```

`main.ts` is the harness driver, kept unchanged from the kit baseline: it reads
every case from `/input/cases.json` (or `MAKEFUN_INPUT_DIR`), answers each with
`run` from `solve.js`, and writes `/output/answers.json` (or `MAKEFUN_OUTPUT_DIR`).

Referral code: `e054nszg` — https://make.fun/r/e054nszg
