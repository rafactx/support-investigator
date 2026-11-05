---
status: superseded by ADR-0026
---

# Full vertical slice, scope kept — simplicity enforced at the architecture level, not by cutting features

The project has no real time constraint (implementation is delegated to coding agents), so the only thing worth optimizing for was demonstrating senior-level engineering across the surface a support-engineering role typically names: tool frontends, service backends, MCP servers, AI agent integrations, CI/CD, and cloud infrastructure. We decided to keep the full vertical slice (agent, custom MCP server, policy gate, IaC, CI, evals) rather than trim it down, and instead push simplicity down into each piece — no unnecessary abstraction, no feature that doesn't earn its place in the 3-minute demo or the architecture conversation. Cutting scope would have left those areas unaddressed for no real time savings.
