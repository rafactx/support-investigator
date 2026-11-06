---
status: accepted
---

# CX insights start aggregate and case correlation must be explicit

A typical CX analytics platform's MCP contract guarantees authorized access to support analytics and conversation analysis, but does not document an identifier or lookup contract that links an external N2 ticket to a CX conversation. The first CX Intelligence Loop will therefore combine privacy-safe investigation dimensions with aggregate CX measures; it may correlate an individual case only when a future platform-provided integration supplies an explicit, authorized reference. We reject matching by transcript text, customer identity or time-window proximity because a plausible join is not auditable evidence that both records describe the same case.

## Consequences

Every persisted investigation can stand alone with its own identity, Account Scope, timestamps, investigation kind, reviewed finding and optional Support Case Reference. Direct CX correlation is an optional capability that can be added behind the integration seam without changing the investigation decision path; its absence reduces insight granularity but never makes the first slice or aggregate insight loop invalid.
