# skill-hdm.md — Manufacturing (HDM-06)

## Module summary
Controls production orders, BOM, material consumption, WIP, and finished
goods. Two variants: discrete (unit-based) and batch (lot-based).

## Clarification questions
- Discrete (each unit), batch (lot), or continuous process?
- Single-level or multi-level BOM?
- Work centers and routing needed or simple orders only?
- By-products or co-products relevant?
- Make-to-order (sales-driven) or make-to-stock?
- Quality inspection at production stages (integrates HDM-14)?

## Features
- core: BOM, production order, material consumption, output
- optional: work centers and routing
- optional: WIP tracking by operation
- optional: by-product and scrap handling
- batch variant adds: lot records, batch genealogy, expiry dates

## KPIs
- Production efficiency (produced vs planned qty)
- Scrap rate by product and work center
- On-time production completion rate
- Material variance (actual vs standard BOM consumption)

## Mock orientation
Generate: 10 products with BOMs, 3 work centers, 15 production orders in
various stages, component consumption records.
