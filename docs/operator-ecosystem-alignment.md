# Operator ecosystem alignment

Leitstand is a read-only observer surface in the Heimgewebe operator ecosystem.

- Chronik owns append-only event history.
- Plexer transports bounded operational events and delivery status.
- Bureau owns tasks, claims, dispatch and completion records.
- Grabowski owns local execution, leases, receipts and audit.
- Heimlern produces retrospective learning and policy-adaptation proposals.
- Leitstand renders views and digests; it does not execute or orchestrate.

Plexer is not the only communication path. Contracts, GitHub/CI, direct artifact reads, Chronik queries and Plexer events are parallel channels. Use the path that preserves evidence and avoids hidden coupling.
