# skill-hdm.md — Supply Chain SCM (HDM-19)

## Module summary
Extends purchasing and inventory with demand planning, carrier management,
transport tracking, and replenishment. For distributors, importers, and
manufacturers with complex supply chains.

## Clarification questions
- Demand forecasting needed or reactive replenishment only?
- Own fleet or third-party carriers?
- Import operations — customs, drawback, SISCOMEX? (Brazil)
- Multi-warehouse transfer orders?
- Supplier portal for collaborative order confirmation?

## Features
- core: demand forecasts, transport orders, carrier tracking
- optional: automatic replenishment suggestions
- optional: multi-warehouse transfer planning
- optional: import documentation management
- plugin-siscomex-brazil: SISCOMEX integration for import operations

## KPIs
- Forecast accuracy (MAPE)
- On-time delivery rate by carrier
- Transport cost per unit/km
- Stockout frequency
- Replenishment lead time

## Mock orientation
Generate: 12 months of demand forecasts for 10 products, 15 transport
orders in various statuses with tracking, 3 carriers.
