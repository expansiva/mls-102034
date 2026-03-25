# skill-hdm.md — Workflow and Approvals (HDM-15)

## Module summary
Generic multi-level approval engine. Used by purchasing (PO approval),
sales (discount approval), HR (time-off), and any module needing
authorization gates. Policies are configurable per entity type.

## Clarification questions
- Approval by value threshold, category, or both?
- Single approver or parallel multi-approver per level?
- Delegation rules when approver is absent?
- Timeout behavior — escalate, auto-approve, or auto-reject?
- Mobile approval via notification needed?

## Features
- core: approval policies, approval requests, decision tracking
- optional: delegation workflow
- optional: escalation on timeout
- optional: push notification to approvers (mobile/email)
- optional: audit trail of all decisions with reasons

## KPIs
- Pending approvals by approver and entity type
- Average approval cycle time by policy
- Rejection rate and top rejection reasons
- Overdue approvals (past deadline)

## Mock orientation
Generate: 4 approval policies (PO by value, time-off, discount, expense),
15 approval requests in various statuses, decision history with reasons.
