# KPI rejected-session recovery TDD evidence

## Source plan

No separate plan was supplied. The journey was derived from the reported production behavior.

## User journey

As a signed-in KPI user whose Main SSO session is no longer accepted by `kpi-api`, I want KPI to stop showing protected cached content and return me to Main, so that I can obtain a fresh authenticated session instead of retrying a request that cannot succeed.

## Task report

1. Added a regression test for terminal auth rejection, cleanup, protected-UI hiding, Main redirect, non-auth error preservation, and redirect-loop prevention.
2. Added `handleKpiAuthFailure` to KPI and invoked it from the daily refresh catch path. HTTP 401 and `invalid_or_expired_token` now fail closed and redirect to Main; transient/non-auth failures retain the existing retry toast.

RED evidence: `node tests/kpi_auth_recovery_test.js` failed with `Function handleKpiAuthFailure not found` before the production change.

GREEN evidence: `node tests/kpi_auth_recovery_test.js` passed with `KPI auth recovery regression checks passed.` after the change.

## Test specification

| # | What is guaranteed | Test file or command | Test type | Result | Evidence |
|---|---|---|---|---|---|
| 1 | Rejected auth clears session keys, hides protected UI, shows a recovery message, and redirects once to Main | `tests/kpi_auth_recovery_test.js` | unit/runtime | PASS | `KPI auth recovery regression checks passed.` |
| 2 | Non-auth failures do not clear the session or redirect | `tests/kpi_auth_recovery_test.js` | unit/runtime | PASS | Same command |
| 3 | Existing SSO expiry recovery remains intact | `tests/auth_test.js` | runtime | PASS | `All SSO Token Recovery Tests Passed!` |
| 4 | Daily API pagination/auth, cache merge, conflict handling, inline syntax and version parity remain intact | `tests/daily_sections_actions_test.js` | integration/runtime | PASS | `PASS actual client pagination/auth, weekly revision/cache merge, conflict no fallback, action revision and inline syntax/version parity` |
| 5 | Concurrent refresh and rejected refresh retry behavior remain intact | `tests/performance_refresh_test.cjs` | runtime | PASS | `PASS concurrent refresh...`, `PASS retry after error` |

## Coverage and known gaps

The repository has no package manifest or configured coverage runner, so an 80% coverage report could not be generated. The focused runtime test and adjacent regression tests were executed directly with Node.

`tests/negative_auth_and_runtime_remediation_test.js` remains a known unrelated failure: its live-bill fixture does not define `document`, while the pre-existing `fetchLiveRequisitions` path reads `document.getElementById`. This task did not modify that path.

No production deployment or authenticated data mutation was performed.

## Checkpoint commits

- RED test checkpoint: `00505da` (`test: reproduce KPI rejected-session recovery`)
- GREEN fix checkpoint: `55f46c3` (`fix: redirect KPI after rejected SSO session`)
