<!-- Follow docs/pull-requests.md. Keep all six required sections; use "Not applicable" where appropriate. Replace prompts with facts and remove these instructions before submission. -->

## Summary

State the capability added or improved and its benefit in one or two sentences.

## Context

Explain what was missing, broken, or difficult, who was affected, and why this change is needed. Link related issues.

## Changes

Describe what changed and how it fixes or improves the situation. Include before/after behavior and relevant implementation decisions.

## API

List added, updated, or removed backend routes by method and path, and describe request/response, authentication/authorization, error, and compatibility changes. Identify updated OpenAPI artifacts when applicable.

If none: No backend route or API contract changes.

## How to Test

List only the prerequisites a reviewer needs, such as stack startup, an account/role, fixture data, or an API client. Then provide numbered steps that exercise the changed behavior as a user or consumer, covering the primary success path and relevant failure or edge paths with observable expected results.

For backend, CLI, or documentation changes, use the corresponding consumer workflow. For internal changes with no new interface, identify the existing workflow to exercise and the behavior that should remain unchanged. Omit routine CI commands, passing test counts, coverage, and lint output.

## Reviewer Notes

Call out risks, migrations/configuration, compatibility or rollout needs, unverified areas, and particular decisions that need attention. Include skipped or unavailable checks, known failures, meaningful verification not covered by CI, and browser-validation ownership only when they affect review. List commit ordering/cherry-pick dependencies, or state that commits are independent.

Confirm author self-review covered behavior and code quality using the [review guide](https://github.com/thomastran117x/Rentify/blob/main/docs/pr-review.md).

## Screenshots

For changes to core frontend pages or flows, include actual screenshots when capture is available. Name the page/state, viewport, and before/after where useful.

If unavailable, explain why and give capture steps or a local artifact path. For non-visual changes: Not applicable.
