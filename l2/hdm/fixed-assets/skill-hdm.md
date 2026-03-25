# skill-hdm.md — Fixed Assets Accounting (HDM-13)

## Module summary
Accounting-side control of capital assets. Depreciation, revaluation, and
GL posting. Distinct from HDM-04 (physical control) — this is the
accounting and tax view. Can coexist and share asset records with HDM-04.

## Clarification questions
- Accounting depreciation only or also fiscal (tax) depreciation?
- Depreciation methods — straight-line, declining balance, or both?
- Asset revaluation required (IFRS)?
- Integration with HDM-04 for physical asset records?
- Disposal: sale, write-off, or donation — different GL treatment for each?

## Features
- core: fixed asset register, depreciation run, GL posting
- optional: tax depreciation parallel ledger
- optional: asset revaluation (IFRS)
- optional: disposal with gain/loss calculation

## KPIs
- Total fixed asset value and accumulated depreciation
- Monthly depreciation charge by asset category
- Assets fully depreciated but still in use
- Depreciation schedule (next 12 months)

## Mock orientation
Generate: 25 fixed assets in various categories, 6 months of depreciation
runs, 2 disposed assets. Mix of straight-line and declining balance.
