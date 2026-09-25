---
'searchcast': patch
---

Talk to the browser over `--remote-debugging-pipe` instead of a loopback TCP DevTools port. searchcast now works for a user that cannot use loopback TCP (it failed to start in a Tor-forced account), and no other process on the machine can reach the browser it drives through an open debugging port.
