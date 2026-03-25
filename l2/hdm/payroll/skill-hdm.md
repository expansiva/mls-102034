# skill-hdm.md — Payroll (HDM-09)

## Module summary
Salary calculation, deductions, taxes, payslips, and government submissions.
Most country-specific module in the catalog — each country is a separate
calculation engine. Brazil uses CLT, INSS, FGTS, IR, eSocial.

## Clarification questions
- Employment regime — CLT, PJ, mixed? (Brazil)
- Payroll frequency — monthly or biweekly?
- Variable compensation — commissions, overtime, bonuses?
- Integration with time tracking for hour-based calculations?
- Which government submissions — eSocial, SEFIP, CAGED? (Brazil)
- 13th salary and vacation calculation method?

## Features
- core: payroll run, payslip generation, payroll events
- optional: commission calculation
- optional: advance payment workflow
- country-plugin-brazil: INSS, FGTS, IR table, eSocial, CAGED, SEFIP

## KPIs
- Total payroll cost by period and department
- Employer contribution rate
- Average salary by department and position
- Payroll run processing time

## Mock orientation
Generate: 20 employees with various positions and salaries, 3 completed
payroll runs, payslips with realistic earnings and deductions lines.
