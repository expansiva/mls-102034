# skill-hdm.md — Maintenance CMMS (HDM-11)

## Module summary
Maintenance of physical assets: corrective and preventive work orders,
spare parts tracking, and availability KPIs. Integrates with HDM-04.

## Clarification questions
- Corrective maintenance only or preventive scheduling also needed?
- Assets from HDM-04 or standalone asset register in CMMS?
- Spare parts inventory from HDM-03 or separate?
- External service providers (third-party maintenance) tracked?
- KPIs needed — MTBF, MTTR, availability percentage?
- Meter-based scheduling (km, hours) for vehicles/machines?

## Features
- core: maintenance assets, work orders (corrective), work order workflow
- optional: preventive schedules with auto-generation
- optional: spare parts consumption from inventory
- optional: external provider and service contract tracking
- optional: meter reading for usage-based maintenance

## KPIs
- Open work orders by priority and asset
- Mean time between failures (MTBF) by asset
- Mean time to repair (MTTR)
- Asset availability rate
- Preventive vs corrective ratio (target >70% preventive)
- Overdue preventive schedules

## Mock orientation
Generate: 15 assets with criticality levels, 20 work orders in various states,
5 preventive schedules (2 overdue), parts consumption records.
