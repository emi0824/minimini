# Debug Session: Lobby Load Squads

Status: [OPEN]

## Symptom

Runtime error in preview/browser console:

```text
Error: [Lobby] load squads failed {}
```

## Constraints

- Do not change business logic before collecting evidence.
- First existing-code change, if needed, must be instrumentation only.
- Fix only this issue and same-class issues; avoid unrelated changes.

## Hypotheses

1. The Lobby page is requesting the wrong API base URL in H5 preview, causing network failure that is logged as `{}`.
2. `GET /api/squads` is returning 401/403/500, but the request wrapper loses useful error fields, so the page logs `{}`.
3. The production API `https://api.viper333.cn/api/squads` is reachable but response shape differs from what `remoteSquad` expects, causing a normalization/runtime exception.
4. H5 preview still depends on a local proxy at `http://127.0.0.1:3000`, but that proxy is not running or points to the wrong target.
5. There are same-class opaque error logs in other pages/services where caught request errors are logged directly, making runtime failures appear as `{}`.

## Evidence Collected

- `src/config/api.ts` configured H5/Web preview to use `http://127.0.0.1:3000`, while non-H5 used `https://api.viper333.cn`.
- PAI preview runs in cloud/HTTPS webview; `127.0.0.1:3000` is not the user's local machine and no matching proxy is available there.
- Production API is healthy:
  - `GET https://api.viper333.cn/api/health` returns `200 { ok: true }`.
  - `GET https://api.viper333.cn/api/squads` returns `200 { ok: true, data: [...] }` with expected squad fields.
- PAI log shows preview service and H5 compile are healthy:
  - `createCloudSession response: code 0`.
  - `cloudServer.start response: status running`.
  - `✅ 编译成功`.
- The catch path is `src/pages/index/index.tsx`, which logs `[Lobby] load squads failed` when `getSquadsApi()` rejects.

## Root Cause

The runtime failure was caused by an outdated H5 preview API override. In PAI preview, the app was built as H5 but executed in a cloud webview, so using `http://127.0.0.1:3000` made the Lobby page request an unreachable local address. That request failure propagated to `getSquadsApi()` and was logged as `[Lobby] load squads failed {}`.

## Fix Applied

- `src/config/api.ts`: removed the H5-only `127.0.0.1:3000` override and made all environments use `https://api.viper333.cn`.
- `src/services/request.ts`: normalized all caught request failures to `Error(message)`, so same-class request failures no longer bubble up as opaque `{}` objects.

## Verification

- `src/config/api.ts` diagnostics: clean.
- `https://api.viper333.cn/api/squads` returns valid data.
- PAI update after code changes completed successfully and compiled:
  - `Update success (pai.updateCloudDev returned)`
  - `✅ 编译成功`

## Expected Result

Lobby should now load squads from `https://api.viper333.cn/api/squads` in PAI preview and no longer throw `[Lobby] load squads failed {}` for the old H5 proxy failure.
