# skill-hdm.md — Inventory (HDM-03)

## Module summary
Controls stock levels, locations, and movements for fungible items.
Two variants: trade (merchandise) and manufacturing (raw + WIP + finished).

## Clarification questions
- Single warehouse or multiple warehouses/locations?
- Lot tracking needed (food, pharma, batches)?
- Serial number tracking needed (equipment, electronics)?
- Costing method — average cost, FIFO, or standard?
- Negative stock allowed or blocked?
- Physical count process — periodic (monthly/annual) or continuous?
- Manufacturing variant: BOM and production order consumption needed?

## Features
- core: warehouse, stock item, stock movement, reorder alerts
- optional: lot tracking, serial number tracking
- optional: physical count / inventory audit
- optional: multi-warehouse transfers
- manufacturing variant adds: BOM, production order consumption, WIP

## KPIs
- Current stock value by warehouse and product category
- Stock turnover rate (movements / average stock)
- Products below reorder point
- Slow-moving items (no movement in N days)
- Physical count variance (system vs counted)

## Mock orientation
Generate: 2 warehouses, 30 stock items across product categories, 50 stock
movements (mix of receipts, issues, adjustments), 5 products below reorder
point to demonstrate alerts.
