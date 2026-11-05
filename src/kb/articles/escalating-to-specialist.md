# When to escalate an investigation to a specialist

The investigator only issues a finding when every piece of required evidence was collected and agrees. In all other cases it stops and asks for a human.

## Escalate when

- **Required intake is missing**: SKU, quantity, seller or destination postal code is unknown or unconfirmed. Complete the intake first.
- **A required check failed**: a lookup was denied, timed out or returned an unexpected payload.
- **Evidence is insufficient**: not every step of the route could be observed.
- **Evidence is contradictory**: the symptom could not be reproduced, or an upstream step failed.
- **The case is unsupported**: the problem is outside the supported findings, such as payment disputes or carrier delays.

## How to hand off

Attach the evidence ledger, not a summary of it. The specialist should see exactly which checks ran, what each returned and which were skipped. Include the customer's own words from the ticket, but keep them separate from the evidence: ticket text is a claim, not proof.

## What not to do

Do not rephrase an escalation as a confident root cause. "Root cause undetermined" is a valid and useful outcome.
