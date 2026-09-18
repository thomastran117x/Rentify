# Pull Request Review Guide

Reviews assess both behavioral correctness and code quality. A change can behave correctly while introducing avoidable maintenance costs; review both dimensions and explain concrete issues rather than relying on personal preferences.

## Review Roles and Authorization

Authors should self-review before handing off: inspect the full diff, check requirements and code quality, run applicable validation, and prepare a clear PR description. During an implementation task, fix issues found in self-review and commit focused corrections according to [AGENTS.md](../AGENTS.md).

A request to review a PR defaults to inspection and findings only. Do not edit files or commit fixes unless the request explicitly includes remediation. Reading the base branch for comparison does not authorize implementing changes on `main` or `master`; use a task branch for authorized fixes.

Return review results to the requesting user. Publishing GitHub comments, submitting an approval or request for changes, and merging require explicit authorization. A local assessment is not a remote review submission.

## Establish Context and Evidence

1. Identify the PR's actual target branch and head, read its description and acceptance criteria, and read applicable repository and directory instructions. Do not assume the target is `main`.
2. Inspect the complete diff from the merge base with the target, the commit sequence, and relevant surrounding code. Trace changed behavior through frontend clients, API handlers, services, persistence, and workers where affected. Inspect existing callers and tests before concluding a change is wrong.
3. Compare implementation with intended behavior and established repository patterns. Focus on problems introduced or materially worsened by the change; distinguish pre-existing issues from PR findings.
4. Inspect available CI results and author validation evidence. Record the reviewed head SHA so the assessment is tied to a specific revision. If PR metadata, CI, or the target revision is unavailable, state the limitation and the comparison used.

For a local comparison, substitute the confirmed target reference in:

```bash
git diff --stat TARGET...HEAD
git diff TARGET...HEAD
git log --oneline TARGET..HEAD
```

## Behavioral Correctness

Assess the relevant areas rather than mechanically checking every subsystem:

- Success paths, validation and failure paths, missing/empty data, malformed responses, refresh behavior, and boundary values.
- Authentication and backend authorization, role/organization boundaries, sensitive data exposure, and consistency with frontend access rules.
- Persistence and transactions, data integrity, migration compatibility, concurrency, locking, and duplicate or retried operations.
- API payloads, status/error shapes, callers, committed OpenAPI artifacts, and operation integration coverage.
- Worker triggers, dependencies, retry/dead-letter behavior, idempotency where implemented, and shutdown/resource handling.
- Loading/error/empty states and responsive behavior for user-facing changes.
- Meaningful tests for changed behavior and regressions, including real persistence integration coverage where affected. Do not accept lowered coverage thresholds as a fix.

Explain how a defect is triggered and its consequence. Confirm the relevant path in source or tests; do not present a hypothetical possibility as an established bug.

## Code Quality and Maintainability

Review these areas even when the success path is correct:

| Area                          | What to assess                                                                                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Readability and naming        | Whether names communicate intent, control flow is understandable, and comments explain non-obvious decisions accurately                                    |
| Cohesion and responsibilities | Whether routes/controllers, services, repositories, UI components, and worker entrypoints keep responsibilities aligned with existing patterns             |
| Complexity                    | Unnecessary branches, nesting, state, indirection, or configuration that make changes harder to reason about                                               |
| Duplication and abstractions  | Repeated domain rules likely to drift; abstractions that obscure intent or combine unrelated concerns; avoid abstraction solely for superficial similarity |
| Types and interfaces          | Clear contracts, useful narrowing, excessive casts or `any`, and APIs that force callers to know internal details                                          |
| Errors and dependencies       | Consistent error handling, resource ownership, useful logs, dependency direction, accidental coupling, and unnecessary new dependencies                    |
| Conventions                   | Consistency with established codebase structure and patterns, while recognizing justified improvements                                                     |
| Test maintainability          | Observable behavior assertions, realistic cases, understandable fixtures, isolation, and tests that avoid mirroring implementation details                 |

Report concrete quality problems even without a current runtime failure. For example, two new copies of a cancellation policy can drift during the next change; explain which rules are duplicated and suggest sharing the domain decision at the existing service boundary. A large function is not automatically a finding: identify the mixed responsibilities or complexity that creates a practical maintenance problem.

Keep remedies proportional to the PR. Avoid style-only preferences already handled by formatters, speculative future needs, blanket abstraction demands, or unrelated rewrites. Minor optional improvements belong in suggestions, not blocking findings.

## Priorities and Findings

Use priorities based on consequences and urgency, not the finding category:

| Priority | Meaning                                                                                                                                                     |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Critical, immediate action required: for example a demonstrated severe security exposure or broad data loss                                                 |
| P1       | High impact: a major affected flow is broken or the change creates a substantial security, integrity, or maintenance risk requiring correction before merge |
| P2       | Material issue to address: a narrower behavioral defect or concrete code-quality problem with meaningful ongoing cost or risk                               |
| P3       | Low-impact actionable issue that can reasonably be scheduled; optional taste-based suggestions are not findings                                             |

Each finding must include:

- A short title, P0-P3 priority, and category: **Behavioral defect** or **Code-quality issue**.
- A file and line reference to the smallest useful range in changed code.
- Evidence: the triggering conditions/reproduction for defects, or the concrete design/maintenance problem for quality issues.
- Consequences for users, security, data, performance, or future maintenance.
- A proportionate suggested remedy, without requiring the reviewer to implement it.

Consolidate related symptoms with one root cause. Mark uncertainty explicitly; unresolved questions are not confirmed findings.

## Validation and Review Output

Use [testing-guide.md](./testing-guide.md), [CONTRIBUTING.md](../CONTRIBUTING.md), and [dependency-security.md](./dependency-security.md) for applicable checks. Run focused checks when useful and feasible. For runtime or user-facing validation, use the Docker stack and selected browser-validation ownership; do not silently substitute direct package startup. Documentation-only reviews need formatting, link/anchor, command/reference, and diff checks instead.

CI success is supporting evidence, not proof that requirements and quality are satisfied. Record commands and actual outcomes. Distinguish source inspection, author-reported checks, CI results, and checks personally run. If infrastructure or browser tools are unavailable, state what remains unverified rather than claiming success.

Present findings first, ordered by priority, followed by optional suggestions, validation performed, and remaining gaps. Explicitly state the result for both categories, for example:

```text
Reviewed head: <SHA>; target: <branch/reference>
Findings: <ordered findings, or none>
Behavior: <findings, or no actionable behavioral defects found>
Code quality: <findings, or no actionable code-quality issues found>
Optional suggestions: <if any>
Validation: <commands/outcomes, CI evidence, and source inspection>
Gaps: <unavailable checks, open questions, or none>
```

When fixes arrive, inspect the new diff and the changed head, confirm the remedy against each finding, and re-run affected checks where applicable. Resolve findings only after that verification. New review findings and follow-up fixes should remain traceable; do not assume an author's reply alone proves resolution.
