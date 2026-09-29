<!-- dorfl-sidecar: item=task:session-connection-reuse type=task slug=session-connection-reuse allAnswered=false -->

## Q1

**'task:session-connection-reuse' was bounced — how should we proceed?**

> acceptance gate failed (exit 1) on the rebased tip — the failing step was: `pnpm format:check && pnpm build && pnpm test`; its last output was:
>
> - Expected
> + Received
> - 2
> + 3
>  ❯ test/serpcast-connections.test.ts:173:20
>     171|   expect(closed(sessions)).toEqual([0, 1]);
>     172|   await serpcast.search('q', {engines: [a]});
>     173|   expect(sessions).toHaveLength(2);
>        |                    ^
>     174|  });
>     175|
> ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
>  Test Files  1 failed | 14 passed | 6 skipped (21)
>       Tests  1 failed | 222 passed | 48 skipped (271)
>    Start at  16:33:57
>    Duration  1.54s (transform 5.02s, setup 0ms, import 9.26s, tests 2.94s, environment 3ms)
> /tmp/dorfl-fresh-gate-fRKTvq/tip/packages/serpcast:
> [ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL] serpcast@0.1.1 test: `vitest run`
> Exit status 1
> [ELIFECYCLE] Test failed. See above for more details.

<!-- q1 fields: id=q1 kind=stuck -->

**Your answer** (write below this line):
