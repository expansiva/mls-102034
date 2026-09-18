# 102034

## 2026-09-17

- Minute tick: the server calls the optional `onTick(ctx, now)` export of each module's persistence file every 60s (`TICK_ENABLED`, postgres only); `evaluateSchedule` reads a `schedule` written in prose. No central scheduler.

## 2026-09-12

- `/session/info` returns authorities from `claimAuthorities` (top-level ∪ `active_org.teams[].roles`); unused `authorities` field removed.
