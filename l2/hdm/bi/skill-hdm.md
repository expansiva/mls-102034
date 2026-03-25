# skill-hdm.md — Business Intelligence (HDM-20)

## Module summary
Cross-module analytics: KPI dashboards, reports, alerts. Reads from all
active modules — never writes operational data. Makes other modules visible
to decision-makers.

## Clarification questions
- Which KPIs are most important to the business owner?
- Real-time dashboard or end-of-day snapshot?
- Data export needed — Excel, PDF?
- Role-based visibility (managers see all, supervisors see their area)?
- Alert thresholds — notify when KPI crosses a value?

## Features
- core: dashboards, KPI definitions with query templates, alert rules
- optional: scheduled report generation and email delivery
- optional: data export (Excel, CSV, PDF)
- optional: role-based dashboard visibility
- optional: benchmark comparisons (vs previous period, vs target)

## KPIs tracked (from other modules)
This module aggregates KPIs defined in each active HDM module.
Typical management dashboard includes: cash position, AR/AP aging,
open POs, inventory value, sales pipeline, employee headcount,
open NCRs, project budget status.

## Mock orientation
Generate: 3 dashboards (owner, finance manager, operations), 15 KPI
definitions across modules, 5 alert rules. Pre-populate with realistic
values from other mock datasets.
