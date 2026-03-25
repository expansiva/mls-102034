# skill-hdm.md — Financial Management (HDM-01)

## Module summary
Core accounting for any business. Every module that moves money posts here.
Without Financial, no business has a complete picture of its cash and results.

## Clarification questions
- Single company or multi-company (group, branches with separate CNPJ)?
- Is a cost center structure needed for departmental P&L?
- Which closing reports are mandatory — DRE, balance sheet, cash flow?
- Bank reconciliation automated (OFX/API import) or manual entry?
- Integration with fiscal module (HDM-12) required? Mandatory in Brazil.
- Fiscal regime — Simples Nacional, Lucro Presumido, or Lucro Real? (Brazil)

## Features
- core: chart of accounts, journal entries, AP/AR, bank reconciliation
- optional: cost centers, multi-company consolidation, budget vs actual
- optional: foreign currency (multi-currency transactions)
- optional: fixed asset depreciation posting (integrates with HDM-13)

## KPIs
- Cash position (bank balance by account)
- AP aging (overdue payables by bucket: 0-30, 31-60, 61-90, 90+)
- AR aging (overdue receivables by bucket)
- Monthly P&L (revenue vs expense by account group)
- Days payable outstanding (DPO)
- Days sales outstanding (DSO)

## Plugins
- plugin-fiscal-brazil: NF-e posting to financial on goods receipt and sales
- plugin-pix-reconciliation: auto-match PIX transactions to open invoices
- plugin-ofx-import: import bank statements via OFX file

## Mock orientation
Generate: 1 company, chart of accounts with ~30 accounts (assets, liabilities,
equity, revenue, expense), 3 cost centers, 20 journal entries in various
states, 15 open invoices (mix payable/receivable), 10 payments, 20 bank
statement lines (mix reconciled/unreconciled). Ensure some invoices are
overdue to demonstrate aging reports.
