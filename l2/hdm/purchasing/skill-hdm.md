# skill-hdm.md — Purchasing (HDM-02)

## Module summary
Manages the full procurement cycle from purchase requisition to goods receipt
and supplier invoice matching. Controls supplier relationships, POs, approval
flows, and three-quote compliance.

## Clarification questions
- Is a formal purchase order required or is informal buying acceptable?
- Approval by value threshold, by category, or both? What are the thresholds?
- Is three-quote compliance required — legal obligation or internal policy?
- Is a purchase requisition step needed before creating a PO?
- Supplier evaluation and rating needed?
- Contract management with suppliers needed?

## Features
- core: supplier register, purchase order, goods receipt, invoice matching
- optional: purchase requisition with approval flow
- optional: RFQ / three-quote management
- optional: supplier contracts
- optional: supplier quality rating (integrates with HDM-14 Quality)

## KPIs
- Open POs by supplier and status
- Average lead time (PO sent → GR confirmed)
- Invoice match rate (matched vs disputed)
- Overdue POs (expected delivery passed, not received)
- Spend by supplier and category (month/quarter/year)
- Three-quote compliance rate

## Plugins
- plugin-nfe-entrada-brazil: receive and validate inbound NF-e XML, extract
  fiscal key and taxes into PurchaseInvoice.Details
- plugin-approval-flow: multi-level PO approval via HDM-15 Workflow

## Mock orientation
Generate: 10 suppliers in various statuses, 5 open POs in different stages,
3 goods receipts (2 complete, 1 partial), 4 purchase invoices (2 matched,
1 pending, 1 disputed). Include 1 PO pending approval to demonstrate workflow.
