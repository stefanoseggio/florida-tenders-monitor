# Contributing

This repository ships the real, buildable TypeScript source for the **Florida State Procurement Monitor** Apify Actor (MyFloridaMarketPlace Bids & Awards). It is independently maintained by Stefano Seggio as part of the [Delta Registry](https://github.com/stefanoseggio) fleet — there is no separate contributor team, but external bug reports, filter/field proposals, and documentation fixes are welcome.

## Local setup

```bash
git clone https://github.com/stefanoseggio/florida-tenders-monitor.git
cd florida-tenders-monitor
npm install
apify login          # once per machine, needed only for `apify run`
```

No third-party credentials are required — this Actor needs nothing beyond your Apify account: there is no BYOK requirement, no separate MyFloridaMarketPlace credential, and no pooled or resold third-party license involved.

## Development workflow

```bash
npm run start:dev     # tsx src/main.ts, reads ./storage/key_value_stores/default/INPUT.json
npm run lint           # eslint
npm run lint:fix       # eslint --fix
npm run format         # prettier --write .
npm run build          # tsc
npm test               # vitest run, fixture-based (no network calls)
npm run test:live      # cross-env LIVE=1 vitest run - opt-in suite against the real, live MFMP portal
```

`npm test` runs against fixtures in `test/`, so it's safe to run offline and in CI. `npm run test:live` hits the real `vendor.myfloridamarketplace.com` portal — use it sparingly while developing and expect it to be slower and occasionally rate-limited.

## Branch naming

- `fix/<short-description>` — bug fixes
- `feat/<short-description>` — new input fields, new output fields, new filter support
- `docs/<short-description>` — README/documentation-only changes
- `chore/<short-description>` — dependency bumps, tooling, CI changes

## Commit convention

This repository follows [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <short summary>

<optional body>
```

Types used here: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`. The `type` prefix drives automated changelog generation via `release-please` (see [`.github/workflows/release.yml`](.github/workflows/release.yml)) — a `feat:` commit triggers a minor version bump, `fix:` triggers a patch bump, and `feat!:`/a `BREAKING CHANGE:` footer triggers a major bump. Non-conventional commit messages are still accepted but won't be reflected in the auto-generated changelog entry for that change.

## Pull requests

1. Branch, make your change, and ensure `npm run lint`, `npm run build`, and `npm test` all pass locally.
2. Open a PR against `main` using the repository's [PR template](.github/PULL_REQUEST_TEMPLATE.md).
3. CI (`.github/workflows/test.yaml`) runs automatically and must pass before merge.
4. Behavioral changes to the Actor's input/output schema should also update `.actor/input_schema.json` / `.actor/dataset_schema.json` and the corresponding README sections (Input & Output Schema, Reliability) in the same PR — schema and documentation drift is treated as a real bug, not a follow-up.

## Questions or non-code issues

For questions that aren't a code change (pricing, licensing, agency/UNSPSC coverage, enterprise inquiries), use the Apify Store's Issues tab on the [live Actor page](https://apify.com/stefano_seggio/florida-tenders-monitor) rather than a GitHub issue.
