# Dependency Security

This repository installs packages from the public npm registry across three independent workspaces (`backend`, `frontend`, `mcp`). This document describes how those dependencies are checked for known vulnerabilities and tampering, what the CI gate enforces, and how to remediate findings.

## The Three Checks

Each check covers a different failure mode. They are complementary, not redundant.

| Check                  | What it catches                                                                                                               | Where it runs        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `npm audit`            | Published advisories (CVEs/GHSAs) against the resolved dependency tree                                                        | CI gate, blocking    |
| `npm audit signatures` | Packages whose tarball does not match the registry's signature or attestation — the tampered/compromised case                 | CI gate, blocking    |
| Socket.dev GitHub App  | _Behavioral_ supply-chain risk: newly added install scripts, new network/filesystem/shell capability, typosquats, protestware | PR comment, advisory |

`npm audit` only knows about vulnerabilities somebody has already reported. `npm audit signatures` verifies provenance but says nothing about whether the code is malicious. Socket.dev reads what the package actually does. A package can pass all three and still be bad, but each one closes a distinct gap.

## Running the Checks Locally

Every workspace exposes the same three scripts:

```bash
npm run audit              # npm audit --audit-level=high
npm run audit:signatures   # npm audit signatures
npm run audit:all          # both, in order
```

Run them from `backend/`, `frontend/`, or `mcp/`. CI invokes the two granular scripts separately so an advisory failure and a signature failure show up as distinct red steps; `audit:all` exists for local one-shot use.

Because the threshold lives in the npm script rather than the workflow, `npm run audit` locally is exactly the gate CI applies.

## The CI Gate

The `Dependency audit` job in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs as a matrix across all three workspaces on every pull request and every push to `main`. `fail-fast: false` means one workspace's failure does not hide the other two.

The job runs `npm ci` before auditing. This is partly to populate the tree, but it also gives a free lockfile-drift check: `npm ci` hard-fails when `package.json` and `package-lock.json` disagree, which is the exact failure a Dependabot PR or a hand-edited version pin can introduce.

### Severity Policy

The gate is `--audit-level=high`, so **high** and **critical** advisories block a merge. Low and moderate advisories are reported but do not fail the build.

This is a deliberate tradeoff. A hard gate at `moderate` fails on transitive advisories that frequently have no fix available, which trains people to bypass the gate. Tightening later is cheap — change the `audit` script in all three `package.json` files.

### Accepted Risks

Findings below the gate threshold that we have consciously chosen not to fix. Keep this list short and keep it current; anything added here needs a stated exit criterion.

| Workspace        | Advisory                                                                                                                    | Severity | Why accepted                                                                                                                                                                                                                                                                                                                                | Exit criterion                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `backend`, `mcp` | [GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr) — `esbuild` arbitrary file read via the dev server | Low      | Fixed in esbuild 0.28.1, but `tsup@8.5.1` requires `esbuild@^0.27.0` and `tsx` requires `~0.27.0`, so no in-range fix exists. An `overrides` entry would cross a breaking esbuild minor for tsup's plugin API. The advisory only affects esbuild's dev server, which this repo never runs — esbuild is used solely as a build-time bundler. | `tsup` ships esbuild 0.28 support; then drop the pin and re-audit. |

Consider an unfiltered `npm audit` review each quarter so the low/moderate backlog does not silently grow.

## Install-Script Allowlists (`allowScripts`)

npm introduced a per-project allowlist for package install scripts. Each workspace's `package.json` carries an `allowScripts` block keyed by exact `name@version`:

```json
"allowScripts": {
  "bcrypt@6.0.0": true,
  "esbuild@0.27.7": true
}
```

Install scripts are the single most direct path from a compromised package to code execution on a developer machine or a CI runner, so the allowlist is reviewed rather than blanket-approved.

### Required npm Version

**This feature requires npm >= 11.16.0.** All three workspaces declare `engines.npm: ">=11.16.0"` for that reason.

The floor matters more than it looks. `engines.node: ">=24"` alone is not sufficient: Node 24.15.0 satisfies it but bundles npm 11.4.2, where `npm approve-scripts` does not exist as a command and the `allowScripts` field is ignored entirely. On such a toolchain the allowlist is silently inert — installs run every dependency's install script with no warning and no signal that the control is not working.

Check what you have with `npm --version`. Node 24.18.0 and later bundle npm 11.16.0 or newer, which is what CI and all three Docker images run.

To review and approve:

```bash
npm approve-scripts --allow-scripts-pending   # list packages awaiting review
npm approve-scripts <package>                 # approve one, pinned to its version
```

Three things to know:

- **Entries are pinned to exact versions**, so any dependency bump invalidates the matching entry. Refreshing the allowlist is a required step on every dependency PR.
- **`npm approve-scripts` adds but never prunes.** Obsolete entries must be deleted by hand. For example, sharp 0.35 removed its install script entirely (source builds are now opt-in via `build`), so its allowlist entry was deleted rather than bumped.
- **On npm 11.16+ this is advisory** — an unreviewed script prints a warning but still runs. **npm 12 is released and makes it blocking**, so once the `node:24-alpine` images pick up npm 12, any stale or missing entry will fail `npm ci` during the Docker build. Treat the warnings as errors now. All three workspaces currently report no unreviewed install scripts, so the repo is ready for that switch.

Do not run `npm approve-scripts --all`. It approves whatever happens to be pending, which defeats the review.

## Socket.dev GitHub App

Socket.dev covers the behavioral axis that `npm audit` and `npm audit signatures` do not. It requires no workflow changes and no repository secrets.

To install:

1. Go to <https://socket.dev/> and choose **Install GitHub App**, authenticating as the repository owner.
2. Grant access to **this repository only**, not "All repositories".
3. The app requests read access to code, metadata, and pull requests, plus write access to pull request comments and checks.

Once installed, any PR that touches a `package.json` or `package-lock.json` gets a review comment flagging newly introduced install scripts, new network/filesystem/shell capability, typosquats, and protestware.

Socket is **advisory** — a PR comment, not a required status check. The blocking gate remains the `Dependency audit` job. A `socket.yml` at the repository root can tune alert thresholds later; the defaults are a reasonable starting point.

## Dependabot

[`.github/dependabot.yml`](../.github/dependabot.yml) covers all three npm workspaces weekly (Monday 06:00 UTC) and GitHub Actions monthly.

Two properties of the config matter when editing it:

- **Group order is load-bearing.** Dependabot assigns each dependency to the _first_ group whose criteria it matches, and anything matching no group gets an individual PR. The `*-security` groups are listed first so security fixes never get buried inside a large routine chore PR. In the frontend, the `nextjs` and `react` groups precede the catch-all groups so exact-pinned packages that must move in lockstep (`next` with `eslint-config-next`) always land in one PR.
- **Majors are excluded from the catch-all groups** (`*-production` and `*-development`, both `update-types: [minor, patch]`), so an ordinary major arrives as its own reviewable PR rather than riding along with routine updates.

  The `nextjs` and `react` groups are the deliberate exception: they list `major` explicitly. Those packages are version-locked to each other, so excluding majors would push a `next` major out of the group and into two separate individual PRs — one for `next`, one for `eslint-config-next` — each of which fails CI on its own. Grouping them is what keeps the major reviewable.

## Remediation Runbook

Work from lowest risk to highest so a failure is easy to attribute. Never use `npm audit fix --force` — it drags unrelated transitives and is not reproducible.

1. **In-range sweep.** In the affected workspace, run `npm audit fix` (no `--force`). This resolves everything reachable without changing a declared version range.

2. **Handle exact pins by hand.** `npm audit fix` will not move a dependency pinned without a range operator. The frontend pins `next` and `eslint-config-next` this way; edit both together.

3. **Verify the fix actually clears the advisory.** npm's `fixAvailable` field is a hint, not a guarantee. Two failure modes seen in practice:
   - npm reported `nodemailer` as fixable in-range, but the advisory covered `<=9.0.0` while the range topped out at 8.x — the real fix was a major bump.
   - npm reported the frontend `postcss` and `sharp` highs as fixed by bumping `next`, but the newest `next` still depends on the vulnerable versions. Those needed an `overrides` block in `frontend/package.json`.

   After any fix, re-run `npm audit` and confirm the advisory is actually gone.

4. **Apply majors explicitly**, one package at a time (`npm install <pkg>@^<version>`), and read the upstream release notes for each. Type-checking is not sufficient — a major can keep its API and change its behavior.

5. **Refresh `allowScripts`** in every workspace touched, per the section above.

6. **Verify.** Run the workspace's own checks, then `npm run audit:all`:

   ```bash
   cd mcp      && npm run check && npm test && npm run build && npm run audit:all
   cd frontend && npm run lint && npm run test:unit && npm run build && npm run audit:all
   cd backend  && npm run check:all && npm run openapi:check \
               && npm run test:unit:coverage && npm run build && npm run audit:all
   ```

   For backend changes, also run the integration suite — behavioral regressions in an HTTP or database library will not show up in type-checks or unit tests. Bring the stack up with `docker compose up --build` and validate anything that touches native binaries (sharp's libvips, bcrypt) in the container, since the Linux/musl prebuilt path differs from a Windows or macOS development machine.

`npm run openapi:check` matters here even when no route changed: the OpenAPI document is checked against the routes the app actually registers, so a framework bump can shift the contract. If it reports the spec as stale, run `npm run openapi:generate` and commit both `openapi.yaml` and `openapi.json`.
