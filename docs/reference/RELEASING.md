---
summary: "Public release channels, version naming, and cadence"
title: "Release policy"
read_when:
  - Looking for public release channel definitions
  - Looking for version naming and cadence
---

Genesis has three public release lanes:

- stable: published GitHub releases that publish to npm `latest`
- beta: prerelease tags that publish to npm `beta`
- dev: the moving head of `main`

## Version naming

- Stable release version: `YYYY.M.D`
  - Git tag: `vYYYY.M.D`
- Stable correction release version: `YYYY.M.D-N`
  - Git tag: `vYYYY.M.D-N`
- Beta prerelease version: `YYYY.M.D-beta.N`
  - Git tag: `vYYYY.M.D-beta.N`
- Do not zero-pad month or day
- `latest` means the current promoted stable npm release
- `beta` means the current beta install target
- Stable and stable correction GitHub releases publish to npm `latest`
  automatically when the GitHub release is published
- Every stable Genesis release ships the npm package and macOS app together;
  beta releases normally validate and publish the npm/package path first, with
  mac app build/sign/notarize reserved for stable unless explicitly requested

## Release cadence

- Releases move beta-first
- Stable follows only after the latest beta is validated
- Maintainers normally cut releases from a `release/YYYY.M.D` branch created
  from current `main`, so release validation and fixes do not block new
  development on `main`
- If a beta tag has been pushed or published and needs a fix, maintainers cut
  the next `-beta.N` tag instead of deleting or recreating the old beta tag
- Detailed release procedure, approvals, credentials, and recovery notes are
  maintainer-only

## Release preflight

- Run `pnpm check:test-types` before release preflight so test TypeScript stays
  covered outside the faster local `pnpm check` gate
- Run `pnpm check:architecture` before release preflight so the broader import
  cycle and architecture boundary checks are green outside the faster local gate
- Run `pnpm build && pnpm ui:build` before `pnpm release:check` so the expected
  `dist/*` release artifacts and Control UI bundle exist for the pack
  validation step
- Run `pnpm release:check` before every tagged release
- Release checks now run in a separate manual workflow:
  `Genesis Release Checks`
- `Genesis Release Checks` also runs the QA Lab mock parity gate plus the live
  Matrix and Telegram QA lanes before release approval. The live lanes use the
  `qa-live-shared` environment; Telegram also uses Convex CI credential leases.
- Cross-OS install and upgrade runtime validation is dispatched from the
  private caller workflow
  `genesis/releases-private/.github/workflows/genesis-cross-os-release-checks.yml`,
  which invokes the reusable public workflow
  `.github/workflows/genesis-cross-os-release-checks-reusable.yml`
- This split is intentional: keep the real npm release path short,
  deterministic, and artifact-focused, while slower live checks stay in their
  own lane so they do not stall or block publish
- Release checks must be dispatched from the `main` workflow ref or from a
  `release/YYYY.M.D` workflow ref so the workflow logic and secrets stay
  controlled
- That workflow accepts either an existing release tag or the current full
  40-character workflow-branch commit SHA
- In commit-SHA mode it only accepts the current workflow-branch HEAD; use a
  release tag for older release commits
- `Genesis NPM Release` publishes only from a real release tag. It runs on
  GitHub-hosted runners so npm trusted publishing can issue provenance through
  GitHub OIDC.
- `Genesis Release Checks` runs
  `GENESIS_LIVE_TEST=1 GENESIS_LIVE_CACHE_TEST=1 pnpm test:live:cache`
  using both `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` workflow secrets
- npm release publishing does not wait on the separate release checks lane
- Run `RELEASE_TAG=vYYYY.M.D node --import tsx scripts/genesis-npm-release-check.ts`
  (or the matching beta/correction tag) before approval
- After npm publish, run
  `node --import tsx scripts/genesis-npm-postpublish-verify.ts YYYY.M.D`
  (or the matching beta/correction version) to verify the published registry
  install path in a fresh temp prefix
- The post-publish verifier retries exact-version installs and the expected
  npm dist-tag check for short npm registry propagation windows after publish
- After a beta publish, run `GENESIS_NPM_TELEGRAM_PACKAGE_SPEC=@pixelzx/genesis@YYYY.M.D-beta.N GENESIS_NPM_TELEGRAM_CREDENTIAL_SOURCE=convex GENESIS_NPM_TELEGRAM_CREDENTIAL_ROLE=ci pnpm test:docker:npm-telegram-live`
  to verify installed-package onboarding, Telegram setup, and real Telegram E2E
  against the published npm package using the shared leased Telegram credential
  pool. Local maintainer one-offs may omit the Convex vars and pass the three
  `GENESIS_QA_TELEGRAM_*` env credentials directly.
- Maintainers can run the same post-publish check from GitHub Actions via the
  manual `NPM Telegram Beta E2E` workflow. It is intentionally manual-only and
  does not run on every merge.
- Maintainer release automation now publishes from the GitHub release event:
  - publishing a GitHub prerelease or `vYYYY.M.D-beta.N` tag publishes
    `@pixelzx/genesis@YYYY.M.D-beta.N` to the npm `beta` dist-tag
  - publishing a stable or correction GitHub release publishes
    `@pixelzx/genesis@YYYY.M.D` or `@pixelzx/genesis@YYYY.M.D-N` to the npm
    `latest` dist-tag
  - the workflow still supports manual dispatch for recovery runs
  - token-based npm dist-tag mutation now lives in
    `genesis/releases-private/.github/workflows/genesis-npm-dist-tags.yml`
    for security, because `npm dist-tag add` still needs `NPM_TOKEN` while the
    public repo keeps OIDC-only publish
  - public `macOS Release` is validation-only
  - real private mac publish must pass successful private mac
    `preflight_run_id` and `validate_run_id`
  - the private mac publish path promotes prepared artifacts instead of
    rebuilding them again
- For stable correction releases like `YYYY.M.D-N`, the post-publish verifier
  also checks the same temp-prefix upgrade path from `YYYY.M.D` to `YYYY.M.D-N`
  so release corrections cannot silently leave older global installs on the
  base stable payload
- npm release workflow fails closed unless the tarball includes both
  `dist/control-ui/index.html` and a non-empty `dist/control-ui/assets/` payload
  so we do not ship an empty browser dashboard again
- Post-publish verification also checks that the published registry install
  contains non-empty bundled plugin runtime deps under the root `dist/*`
  layout. A release that ships with missing or empty bundled plugin
  dependency payloads fails the postpublish verifier and cannot be promoted
  to `latest`.
- `pnpm test:install:smoke` also enforces the npm pack `unpackedSize` budget on
  the candidate update tarball, so installer e2e catches accidental pack bloat
  before the release publish path
- If the release work touched CI planning, extension timing manifests, or
  extension test matrices, regenerate and review the planner-owned
  `checks-node-extensions` workflow matrix outputs from `.github/workflows/ci.yml`
  before approval so release notes do not describe a stale CI layout
- Stable macOS release readiness also includes the updater surfaces:
  - the GitHub release must end up with the packaged `.zip`, `.dmg`, and `.dSYM.zip`
  - `appcast.xml` on `main` must point at the new stable zip after publish
  - the packaged app must keep a non-debug bundle id, a non-empty Sparkle feed
    URL, and a `CFBundleVersion` at or above the canonical Sparkle build floor
    for that release version

## NPM workflow inputs

`Genesis NPM Release` runs automatically when a GitHub release is published. It
also accepts these manual-dispatch recovery inputs:

- `tag`: required release tag such as `v2026.4.2`, `v2026.4.2-1`, or
  `v2026.4.2-beta.1`
- `npm_dist_tag`: `auto`, `beta`, or `latest`; `auto` publishes beta
  prereleases to `beta` and stable releases to `latest`

`Genesis Release Checks` accepts these operator-controlled inputs:

- `ref`: existing release tag or the current full 40-character `main` commit
  SHA to validate when dispatched from `main`; from a release branch, use an
  existing release tag or the current full 40-character release-branch commit
  SHA

Rules:

- Automatic release-published runs publish stable and correction tags to
  `latest`
- Beta prerelease tags may publish only to `beta`
- `Genesis Release Checks` is always validation-only and also accepts the
  current workflow-branch commit SHA
- Release checks commit-SHA mode also requires the current workflow-branch HEAD
- Manual recovery dispatch can choose `beta` or `latest` for stable and
  correction tags

## Stable npm release sequence

When cutting a stable npm release:

1. Run `Genesis Release Checks` separately with the same tag or the
   full current workflow-branch commit SHA when you want live prompt cache,
   QA Lab parity, Matrix, and Telegram coverage
   - This is separate on purpose so live coverage stays available without
     recoupling long-running or flaky checks to the publish workflow
2. Publish the GitHub release for the tag. `Genesis NPM Release` starts from
   the release-published event, validates the tag/package metadata, builds the
   release artifacts, runs the npm release checks, publishes to npm `latest`,
   and verifies the published install path.
3. If `beta` should follow the same stable build immediately, use the private
   `genesis/releases-private/.github/workflows/genesis-npm-dist-tags.yml`
   workflow to point `beta` at the stable version, or let its scheduled
   self-healing sync move `beta` later.

The dist-tag mutation lives in the private repo for security because it still
requires `NPM_TOKEN`, while the public repo keeps OIDC-only publish.

That keeps the direct publish path and the beta-first promotion path both
documented and operator-visible.

If a maintainer must fall back to local npm authentication, run any 1Password
CLI (`op`) commands only inside a dedicated tmux session. Do not call `op`
directly from the main agent shell; keeping it inside tmux makes prompts,
alerts, and OTP handling observable and prevents repeated host alerts.

## Public references

- [`.github/workflows/genesis-npm-release.yml`](https://github.com/PIXELZX0/Genesis/blob/main/.github/workflows/genesis-npm-release.yml)
- [`.github/workflows/genesis-release-checks.yml`](https://github.com/PIXELZX0/Genesis/blob/main/.github/workflows/genesis-release-checks.yml)
- [`.github/workflows/genesis-cross-os-release-checks-reusable.yml`](https://github.com/PIXELZX0/Genesis/blob/main/.github/workflows/genesis-cross-os-release-checks-reusable.yml)
- [`scripts/genesis-npm-release-check.ts`](https://github.com/PIXELZX0/Genesis/blob/main/scripts/genesis-npm-release-check.ts)
- [`scripts/package-mac-dist.sh`](https://github.com/PIXELZX0/Genesis/blob/main/scripts/package-mac-dist.sh)
- [`scripts/make_appcast.sh`](https://github.com/PIXELZX0/Genesis/blob/main/scripts/make_appcast.sh)

Maintainers use the private release docs in
[`genesis/maintainers/release/README.md`](https://github.com/genesis/maintainers/blob/main/release/README.md)
for the actual runbook.

## Related

- [Release channels](/install/development-channels)
