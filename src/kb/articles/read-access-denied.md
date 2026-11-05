# Read access denied during an investigation

Investigations use read-only credentials. Sometimes a lookup is rejected with a permission error (HTTP 403) instead of returning data. Typical causes:

- the order belongs to another seller account than the one support has access to;
- the credential's role lacks read access to logistics configuration (warehouses, docks or shipping policies);
- a credential was rotated and the old one revoked.

## Why it matters

A denied read is not the same as "not found". A missing order is a normal answer; a permission error means the evidence could not be collected at all. The investigator must never treat a denied read as proof that something does not exist, and must not guess the missing evidence.

## What to do

1. Note which capability was denied and for which id.
2. Mark the investigation as requiring human review; no finding is possible from partial evidence.
3. Ask an administrator to confirm the credential's scope, or route the case to a team that owns the account.

Never ask the customer or merchant for their own credentials to work around a denied read.
