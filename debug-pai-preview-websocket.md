# Debug Session: PAI Preview WebSocket

Status: [OPEN]

## Symptom

Trae PAI preview page reports `WebSocket error`, and preview service appears closed after restart.

## Known Evidence So Far

- Preview URL printed: `https://trae.mobile.volcapp.com/preview/?ws=ws://localhost:62048`
- Browser reports WebSocket error.
- `.pai/pai.log` shows PAI cloud session creation fails with `登录凭证缺失，请退出账户重新登录后重试`.
- Trae main logs show OAuth login can succeed and write `ide_credential`.
- Previous stale preview processes have occupied `62048` and left stale lock files.

## Hypotheses

1. The preview wrapper prints a URL before the server-mode child fails, leaving a stale lock and causing the WebSocket page to connect to a dead port.
2. The PAI script reads only the legacy `TRAE_JWT_TOKEN_PATH=/Users/m10003000193/.trae/trae-jwt-token`, while current Trae stores credentials elsewhere as `ide_credential`.
3. The preview server has a local-debug or server-mode flag that can keep the local WebSocket server alive without creating a cloud session, but the wrapper invocation is not using it.
4. A stale `.pai/pai-preview-server.lock` causes the wrapper to reuse a dead port/PID and not launch a healthy server.
5. Node v24 runtime compatibility causes the preview script/child process to exit after cloud-session failure instead of staying alive and reporting a recoverable error.

## Evidence Collected

### Pre-fix / failing evidence

- `.pai/pai.log` showed `createCloudSession failed` with `登录凭证缺失，请退出账户重新登录后重试`.
- Lock file pointed to preview PID/port, but no healthy listener remained on `62048`.
- Browser reported `WebSocket error` because the preview page connected to a dead local WebSocket endpoint.

### New evidence after retry

- Trae main log showed temp JWT was generated and written:
  - `TokenManager setJwtTokenEnabled: true`
  - `Writing temp token file to: /Users/m10003000193/.trae/trae-jwt-token`
  - `Temp token file written successfully`
- Local check confirmed `/Users/m10003000193/.trae/trae-jwt-token` exists.
- Fresh PAI log shows cloud session success:
  - `createCloudSession response: { code: 0, msg: "success" }`
  - `cloudServer.start response: { status: "running" }`
  - `✅ 编译成功`
  - `Frontend connected, clients size = 1`

## Current Conclusion

The issue was not simply that the user was not logged in. The immediate failure path was: PAI preview needed the legacy temp JWT file; at the time of failing runs, Trae had not generated `/Users/m10003000193/.trae/trae-jwt-token`, so cloud session creation failed and the local WebSocket endpoint closed. After Trae generated the temp token file, preview startup succeeded.

## Current Preview

`https://trae.mobile.volcapp.com/preview/?ws=ws://localhost:62048`

## Verification Needed

User should confirm whether the preview page no longer shows `WebSocket error` and whether the miniapp UI loads normally.
