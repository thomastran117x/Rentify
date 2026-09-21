# Writing Pull Requests

A PR description should explain the problem, resulting behavior, and evidence needed to review it without reading the original conversation. Use the [default template](../.github/PULL_REQUEST_TEMPLATE.md), or the specialized [feature](../.github/PULL_REQUEST_TEMPLATE/feature.md) and [bug](../.github/PULL_REQUEST_TEMPLATE/bug.md) templates. All share the same required sections.

## Title and Formatting

Use a short, concrete title around the final change, such as `fix(bookings): reject expired approvals`. Follow [CONTRIBUTING.md](../CONTRIBUTING.md) for logical commits and [pr-review.md](./pr-review.md) for author self-review and reviewer expectations.

Use Markdown `##` headings, short connected paragraphs, bullets for parallel changes, numbered steps for reproduction, and fenced code blocks for commands. Label shell-specific examples. Wrap commands, route paths, and identifiers in backticks. Leave blank lines around headings, lists, and code fences so GitHub renders them correctly.

Scale detail to the change. Keep all six sections below, using an explicit "Not applicable" or "No changes" when needed. Replace template prompts with facts and remove instructional comments before submission. Rewrite the title/body when scope changes; omit abandoned approaches and conversational history unless they explain a current tradeoff.

## Required Sections

| Section        | What to include                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Summary        | One or two sentences stating the concrete problem and resulting behavior/capability                                      |
| Context        | What was missing or broken, the trigger and impact, related issues, and confirmed root cause for a bug                   |
| Changes        | What changed, how it improves/fixes the problem, before/after behavior, and implementation decisions useful to reviewers |
| API            | Added, updated, or removed backend routes/contracts and compatibility implications; explicitly state when none changed   |
| How to Test    | Minimal prerequisites, reproducible consumer steps, and observable expected results                                      |
| Reviewer Notes | Risks, migrations/configuration/rollout needs, unverified areas, decisions needing attention, and commit dependencies    |

### API Details

For each affected route, name its HTTP method and path, whether it is new/updated/removed, and relevant request/response/status/error changes. Include authentication, authorization, and compatibility changes even if the path stayed the same. Request examples or a compact before/after table can help when the contract changes materially.

Identify updates to `backend/openapi/openapi.yaml` and `backend/openapi/openapi.json`. Do not generate or alter contracts merely to fill out this section. Internal backend changes without route/contract changes can say: "No backend route or API contract changes."

### How to Test

Write this section for the reviewer who needs to exercise the changed behavior. Start with only the prerequisites they need, such as the stack startup command, seeded account and role, fixture data, feature flag, or API client. Then give numbered steps for the primary success path and each relevant failure, validation, or edge path. State the observable result after each meaningful action so the reviewer can tell whether the behavior is correct.

Describe the workflow at the interface the change affects:

- For frontend changes, explain where to navigate and what to do in the UI.
- For backend changes, provide requests a consumer can send and the responses or persisted effects to verify.
- For CLI changes, show the invocation and its visible output or side effects.
- For documentation changes, explain how to follow the changed instructions and confirm that links, examples, or navigation work.
- For internal changes with no new interface, name the existing workflow to exercise and the behavior that must remain unchanged.

Do not duplicate routine CI evidence in the PR description. Omit command inventories, passing test counts, coverage percentages, lint output, and checks already enforced by CI. Keep the implementation handoff aligned with [testing-guide.md](./testing-guide.md), which still requires reporting the checks that actually ran.

Use Reviewer Notes for exceptional validation information that affects review: skipped or unavailable checks, known failures, meaningful verification not covered by CI, environmental limitations, and unverified risks. Mention browser-validation ownership only when a flow remains for the reviewer or author to verify. Avoid ambiguous statements such as "tested locally."

## Screenshots for Core Frontend Changes

Add a `## Screenshots` section for visual changes to core pages or flows, such as marketplace browsing/detail, posting management, authentication/account, booking/checkout, and organization dashboards. Include actual captures when browser access is available; a mockup is not evidence of the implemented UI.

Capture the affected page after it settles, with a caption naming the page, state, and viewport. Show desktop/mobile views when responsiveness is affected, before/after when comparison helps, and validation/error/empty states when those are the change. Use seeded or controlled data and keep secrets and personal information out of captures.

Agents should capture images during the applicable browser-validation flow when tooling permits it. Provide local artifact paths for handoff or attach images when PR publication is authorized. The existing Playwright suite automatically captures failures; those images alone may not demonstrate the improved success state.

Use descriptive image alt text and captions when embedding attachments:

```markdown
![Booking approval validation on desktop](attached-image-url)

Booking details, expired approval validation, desktop viewport 1440 × 900.
```

Replace the placeholder URL with the actual uploaded image URL. If capture is unavailable, write "Screenshot unavailable", explain the concrete limitation, and provide steps to reach/capture the affected state. Do not invent images or claim screenshots were attached. Missing screenshots alone do not waive browser-validation requirements or require agents to abandon otherwise completed work. Non-visual changes can mark screenshots not applicable.

## Copyable Description

```markdown
## Summary

Describe the problem and resulting behavior.

## Context

Explain what was missing or broken, its impact, and related issues.

## Changes

Describe the improvement/fix and relevant before/after behavior.

## API

List affected methods/paths and contract changes, or state there are none.

## How to Test

List only the prerequisites a reviewer needs, then give numbered consumer steps and
observable expected results for the success and relevant failure/edge paths.

## Reviewer Notes

Record risks, migrations/configuration, review focus, commit dependencies, and any
exceptional skipped, unavailable, failing, or non-CI validation.

## Screenshots

Attach actual captures with captions, explain why unavailable, or mark not applicable.
```

Prepare a complete description before handoff or authorized publication. Use a structured tool argument, or write the exact multiline body to a temporary file and pass `--body-file` when using `gh`; preserve actual newlines. Preparing the description does not authorize publishing a PR or review.
