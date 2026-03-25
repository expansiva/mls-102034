# skill-hdm.md — Asset Management / Patrimony (HDM-04)

## Module summary
Tracks individually identified physical assets. Each asset has its own
identity, location, assigned person, and lifecycle. Distinct from inventory
— assets are not consumed, they are used, transferred, and depreciated.

## Clarification questions
- What asset categories exist? (IT, furniture, vehicles, machinery, tools)
- Is depreciation calculation needed or physical control only?
- Asset assigned to employee, to location (room/floor), or both?
- Barcode or QR label printing for physical audit?
- Integration with maintenance orders (HDM-11 CMMS)?
- Integration with fixed assets accounting (HDM-13)?

## Features
- core: asset register, categories, transfer between locations/persons
- optional: depreciation calculation and posting to financial
- optional: barcode/QR label generation
- optional: physical audit checklist
- optional: integration with CMMS for maintenance history

## KPIs
- Total asset count and value by category
- Assets by location and assigned person
- Depreciation schedule (next 12 months)
- Assets in maintenance or with issues
- Assets approaching end of useful life

## Mock orientation
Generate: 4 asset categories (IT, furniture, vehicles, machinery), 40 assets
in various statuses, 10 transfer records, 6 months of depreciation history.
