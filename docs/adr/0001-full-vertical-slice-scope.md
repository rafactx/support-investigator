---
status: superseded by ADR-0026
---

# Full vertical slice, scope kept — simplicity enforced at the architecture level, not by cutting features

The project had no fixed deadline, so scope was set by the surface a support-investigation tool touches end to end: tool frontends, service backends, MCP servers, AI agent integrations, CI/CD, and cloud infrastructure. We decided to keep the full vertical slice (agent, custom MCP server, policy gate, IaC, CI, evals) rather than trim it down, and instead push simplicity down into each piece — no unnecessary abstraction, no feature that doesn't earn its place in the end-to-end demo or the architecture. Cutting scope would have left those areas unaddressed for no real time savings.
