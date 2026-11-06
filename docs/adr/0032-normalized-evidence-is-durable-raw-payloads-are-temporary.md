---
status: accepted
---

# Normalized evidence is durable; raw payloads are temporary

The durable Evidence Ledger stores only the normalized facts needed by Evidence Contracts together with their provenance, hashes and schema or policy versions. Raw operational payloads are not retained indefinitely because orders and customer records can contain data unrelated to the investigation and create avoidable privacy, access-control and deletion obligations. Unstructured support-ticket text is treated as equally transient input: this slice uses it in memory for intake extraction but does not persist or log it. A future explicit debugging or audit requirement may define encrypted, access-restricted and short-lived raw storage, but this slice has no such store.

## Consequences

Product Insights and routine investigation replay use accepted structured intake and normalized ledger facts, not raw responses, prompts or transcripts. Synthetic fixtures may be versioned with the code when clearly labeled and free of production data. Application logs use a field allowlist and never become an alternative raw-payload store.
