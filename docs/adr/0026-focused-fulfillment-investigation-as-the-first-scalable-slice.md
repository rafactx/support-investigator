---
status: accepted
---

# Fulfillment investigation is the first bounded slice; scale comes from additional investigation kinds

The project was previously scoped to cover every layer of a broad support-engineering toolset in one vertical slice (`ADR-0001`), which produced more surface area than operational depth. We now optimize for an internal N2 outcome: handle the stock-but-no-delivery-option fulfillment investigation end to end, including its adjacent order and documentary evidence, before expanding to other recurring problems. Future scale means adding bounded investigation kinds behind stable product and capability interfaces, not widening one generic support-agent prompt; this keeps the frontend, backend, MCP, AI, RAG, AWS, CI/CD, and insight loop in service of a measurable workflow rather than treating them as independent checklist items.
