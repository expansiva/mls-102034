# skill-horizontal-index.md

## Purpose

This is the **entry point for horizontal module discovery**. When a user
describes their business — a pet shop, a pharmacy, a furniture manufacturer,
a law firm — the agent reads this index first to identify which horizontal
modules are relevant, presents them to the user for selection, and then
loads the specific `skill-hdm` of each selected module before planning
begins.

This index does **not** replace the individual module skills. It provides
enough context for the agent to make a good recommendation and ask the right
opening questions. Detailed ontology, rules, clarifications, KPIs, and mock
guidance live in each module's own files.

---

## How the agent uses this index

1. User describes their business or requests a system
2. Agent reads this index and selects candidate modules (typically 3–8)
3. Agent presents candidates to the user — confirms what to include, what
   to exclude, and what the user did not think of
4. For each confirmed module, agent loads `skill-hdm.md` from the module
   folder and begins clarification
5. Agent never assumes — it always confirms scope with the user before
   generating anything

The agent should suggest modules the user did not mention. A pet shop owner
asking for "a sales system" probably also needs purchasing and inventory.
A furniture factory asking for "production control" probably also needs
quality management and asset tracking.

---

## Module Index

---

### HDM-01 · Financial Management

**Folder:** `/hdm/financial/`

**Description:** Core accounting engine for any business. Manages the general
ledger, accounts payable, accounts receivable, bank reconciliation, cost
centers, and financial reporting. Every other module that moves money
integrates here. Without this module, no business has a complete financial
picture.

**Relevant for:** every business with more than one person doing finances.

**Key decisions the agent must explore:**
- Multi-company or single company?
- Cost center structure needed?
- Which reports are mandatory (DRE, balance sheet, cash flow)?
- Bank reconciliation automated or manual?
- Integration with fiscal module required? (mandatory in Brazil)

**Integrates with:** HDM-02 (Purchasing), HDM-05 (Sales), HDM-07 (Payroll),
HDM-12 (Fiscal Engine), HDM-13 (Fixed Assets)

**Country variation:** very high — chart of accounts, tax treatment, and
reporting formats differ significantly per country.

---

### HDM-02 · Purchasing

**Folder:** `/hdm/purchasing/`

**Description:** Manages the full procurement cycle from purchase requisition
to goods receipt and supplier invoice. Controls supplier relationships,
purchase orders, approval flows, and three-quote compliance. Integrates with
inventory to update stock on receipt and with financial to trigger payment.

**Relevant for:** any business that buys goods or services from third parties.

**Key decisions the agent must explore:**
- Is a formal purchase order required or is informal buying acceptable?
- How many approval levels? Approved by value threshold or by category?
- Is three-quote compliance required (legal or internal policy)?
- Supplier evaluation and scoring needed?
- Direct purchasing (no stock) or purchase-to-stock flow?

**Integrates with:** HDM-01 (Financial), HDM-03 (Inventory), HDM-12 (Fiscal),
HDM-15 (Workflow Approvals)

**Country variation:** medium — PO process is universal; inbound fiscal
document (NF-e entrada in Brazil, CFDI in Mexico) adds local complexity.

---

### HDM-03 · Inventory — Products and Materials

**Folder:** `/hdm/inventory/`

**Description:** Controls stock levels, locations, and movements for fungible
items — raw materials, finished goods, merchandise, consumables. Tracks
quantities by item, warehouse, and lot. Supports FIFO, average cost, and
standard cost valuation. Raises reorder alerts and supports physical count
reconciliation.

**Relevant for:** any business that stores and moves physical items.

**Key decisions the agent must explore:**
- Single warehouse or multi-warehouse?
- Lot and serial number tracking needed?
- Which costing method — FIFO, average cost, or standard?
- Is physical count (inventory audit) a periodic process?
- Raw material + finished goods (manufacturing) or merchandise only (trade)?

**Template variants:**
- `inventory-trade` — merchandise for resale, simpler movements
- `inventory-manufacturing` — raw materials, WIP, finished goods, BOM consumption

These two variants differ enough in entity structure (BOM, production orders,
WIP) to warrant separate templates. The agent must identify which applies
before loading the ontology.

**Integrates with:** HDM-02 (Purchasing), HDM-05 (Sales), HDM-06 (Manufacturing),
HDM-12 (Fiscal), HDM-14 (Asset Management)

**Country variation:** low — stock movement logic is universal; fiscal
escrituração is handled by HDM-12.

---

### HDM-04 · Asset Management — Patrimony

**Folder:** `/hdm/asset-management/`

**Description:** Tracks individually identified physical assets owned by the
company — furniture, IT equipment, vehicles, machinery, tools. Each asset
has its own identity, location, assigned responsible person, acquisition
history, and maintenance record. Distinct from inventory: assets are not
consumed, they are used, depreciated, transferred, and eventually disposed.

**Relevant for:** any business with physical assets worth controlling —
especially companies subject to audit or with significant capital goods.

**Key decisions the agent must explore:**
- What asset categories exist? (IT, furniture, vehicles, machinery...)
- Is depreciation calculation needed or only physical control?
- Asset assignment to employee or to location (room, floor, branch)?
- Integration with maintenance orders (CMMS) needed?
- Barcode or QR code labeling required for physical audit?

**Integrates with:** HDM-01 (Financial — depreciation), HDM-10 (CMMS),
HDM-13 (Fixed Assets — accounting view), MDM (Company, Person, Location)

**Country variation:** low for physical control; medium for depreciation
(tax depreciation rates are country-specific).

---

### HDM-05 · Sales and Order Management

**Folder:** `/hdm/sales/`

**Description:** Manages the outbound commercial cycle from quote to delivery
and billing. Handles customer orders, pricing rules, delivery scheduling,
and sales invoicing. Integrates with inventory to reserve and consume stock
and with financial to generate receivables. Supports B2B and B2C flows.

**Relevant for:** any business that sells products or services with a formal
order process.

**Key decisions the agent must explore:**
- Quote-to-order flow or direct order entry?
- Price tables, discounts, and commercial conditions needed?
- Partial delivery allowed or only complete order shipment?
- Return and reverse logistics process needed?
- B2B (company buyers) or B2C (individual buyers) or both?

**Integrates with:** HDM-01 (Financial), HDM-03 (Inventory), HDM-08 (CRM),
HDM-12 (Fiscal — outbound invoice)

**Country variation:** medium — order process is universal; outbound fiscal
document (NF-e saída in Brazil, CFDI in Mexico) adds local complexity.

---

### HDM-06 · Manufacturing

**Folder:** `/hdm/manufacturing/`

**Description:** Controls production orders, bill of materials (BOM),
material consumption, work-in-progress (WIP), and finished goods output.
Supports discrete, batch, and process manufacturing. Integrates with
inventory for material reservation and consumption and with quality for
in-process inspection.

**Relevant for:** companies that transform inputs into outputs — furniture
factories, food producers, garment manufacturers, electronics assemblers.

**Key decisions the agent must explore:**
- Discrete (each unit), batch (lot-based), or continuous process?
- Single-level or multi-level BOM?
- Work centers and routing needed or simple production orders?
- By-products and co-products relevant?
- Integration with quality inspection at production stages?

**Template variants:**
- `manufacturing-discrete` — unit-based production, BOM per product
- `manufacturing-batch` — lot-based production, batch records, expiry

**Integrates with:** HDM-03 (Inventory), HDM-11 (Quality), HDM-10 (CMMS),
HDM-05 (Sales — production-to-order)

**Country variation:** low — production logic is universal; fiscal treatment
of production output handled by HDM-12.

---

### HDM-07 · Human Resources

**Folder:** `/hdm/hr/`

**Description:** Manages the employee lifecycle from hiring to termination.
Covers employee records, organizational structure, positions, contracts,
time-off, benefits administration, performance reviews, and onboarding
workflows. The core HR data (employee, department, position) is universal;
benefit rules and compliance obligations are country-specific.

**Relevant for:** any business with employees — mandatory from the first hire.

**Key decisions the agent must explore:**
- Org chart structure needed — departments, cost centers, hierarchies?
- Performance review cycle and method (360°, manager-only)?
- Time-off policy — accrual rules, approval flow?
- Benefits management needed (health plan, meal voucher, transport)?
- Integration with payroll module or external payroll provider?

**Integrates with:** HDM-08b (Time Tracking), HDM-09 (Payroll),
HDM-15 (Workflow Approvals), MDM (Person)

**Country variation:** medium — employee record is universal; benefits and
labor compliance are highly local.

---

### HDM-08 · CRM — Customer Relationship Management

**Folder:** `/hdm/crm/`

**Description:** Manages the commercial relationship with customers and
prospects. Covers leads, contacts, accounts, opportunities, sales pipeline,
interaction history, and customer segmentation. Provides a 360° view of
the customer across all touchpoints. Integrates with sales for order
follow-up and with marketing for campaign results.

**Relevant for:** any business with a sales team or recurring customer
relationships — B2B especially.

**Key decisions the agent must explore:**
- Sales pipeline stages — how many, what defines each?
- Lead origin tracking needed (marketing source attribution)?
- Account hierarchy — single contact or multiple contacts per company?
- Activity logging — calls, emails, visits — automated or manual?
- Integration with marketing automation for lead nurturing?

**Integrates with:** HDM-05 (Sales), HDM-08b (Marketing Automation),
MDM (Company, Person, ContactChannel)

**Country variation:** low — sales process is universal; GDPR/LGPD consent
management adds local compliance layer.

---

### HDM-08b · Marketing Automation

**Folder:** `/hdm/marketing/`

**Description:** Extends CRM with automated campaign management — email
sequences, lead scoring, segmentation, landing pages, and conversion
attribution. Enables nurturing workflows that move leads through the funnel
without manual intervention. AI-driven personalization and send-time
optimization are increasingly standard.

**Relevant for:** businesses with digital marketing, inbound lead generation,
or recurring communication with large customer bases.

**Key decisions the agent must explore:**
- Email campaigns only or multi-channel (SMS, WhatsApp)?
- Lead scoring model — behavior-based, profile-based, or combined?
- LGPD/GDPR consent capture and management required?
- Integration with existing email provider or built-in sending?

**Integrates with:** HDM-08 (CRM), MDM (Person, ContactChannel)

**Country variation:** low for automation logic; medium for privacy compliance
(LGPD in Brazil, GDPR in Europe require explicit consent records).

---

### HDM-09 · Payroll

**Folder:** `/hdm/payroll/`

**Description:** Calculates employee compensation including gross salary,
deductions, employer contributions, taxes, and net pay. Generates payslips,
payment orders, and statutory reports for government bodies. Payroll is the
most country-specific module in the entire HDM catalog — the calculation
engine is almost entirely different per jurisdiction.

**Relevant for:** every business with employees on a formal employment contract.

**Key decisions the agent must explore:**
- Employment regime — CLT, PJ, mixed? (Brazil-specific but analogous in
  every country)
- Payroll frequency — monthly, biweekly?
- Variable compensation — commissions, bonuses, overtime?
- Integration with time tracking for hour-based calculations?
- Which government submissions are required? (eSocial, SEFIP, CAGED in Brazil)

**Integrates with:** HDM-07 (HR), HDM-08b (Time Tracking), HDM-01 (Financial)

**Country variation:** very high — calculation rules, tax tables, contribution
rates, and government submissions are entirely different per country. Each
country is effectively a separate implementation.

---

### HDM-10 · Time Tracking and Attendance

**Folder:** `/hdm/time-tracking/`

**Description:** Records employee working hours, absences, overtime, and
shift scheduling. Feeds payroll with hours-worked data and HR with
attendance patterns. In Brazil, electronic time tracking (REP) has specific
legal requirements. Supports manual entry, biometric integration, and
mobile clock-in.

**Relevant for:** companies with hourly workers, field teams, shift-based
operations, or strict labor compliance requirements.

**Key decisions the agent must explore:**
- Clock-in method — manual, mobile app, biometric, REP integration?
- Shift scheduling needed or fixed hours only?
- Overtime calculation rules — bank of hours or payment?
- Integration with payroll for automatic hour transfer?
- Brazil REP compliance required?

**Integrates with:** HDM-07 (HR), HDM-09 (Payroll)

**Country variation:** high — labor law defines overtime rules, rest periods,
and recording requirements per country. Brazil REP (electronic time recorder)
has specific technical standards.

---

### HDM-11 · Maintenance — CMMS

**Folder:** `/hdm/cmms/`

**Description:** Manages maintenance of physical assets — equipment,
machinery, vehicles, facilities. Supports corrective maintenance (breakdown
repair), preventive maintenance (scheduled), and predictive maintenance
(condition-based). Generates work orders, tracks labor and parts consumed,
and measures asset availability and MTBF.

**Relevant for:** companies with machinery, vehicles, or facilities where
downtime has operational or financial impact.

**Key decisions the agent must explore:**
- Corrective only or preventive scheduling also needed?
- Asset integration — pull from HDM-04 Asset Management?
- Spare parts inventory managed here or in HDM-03 Inventory?
- External service providers (third-party maintenance) tracked?
- KPIs needed — MTBF, MTTR, availability percentage?

**Integrates with:** HDM-04 (Asset Management), HDM-03 (Inventory — parts),
HDM-02 (Purchasing — parts acquisition)

**Country variation:** low — maintenance process is universal.

---

### HDM-12 · Fiscal Engine

**Folder:** `/hdm/fiscal/`

**Description:** Handles all tax calculation and electronic fiscal document
generation required by local law. In Brazil this covers NF-e (product
invoice), NFS-e (service invoice), CT-e (transport), MDF-e (freight
manifest), and SPED obligations (EFD, ECF, ECD, eSocial, REINF). In other
countries covers e-invoicing per local standard. This module is implemented
as a plugin-per-country — the core defines the interface, each country
plugin provides the implementation.

**Relevant for:** every business operating in a regulated fiscal environment
— mandatory in Brazil, Mexico, Chile, Colombia, and increasingly everywhere.

**Key decisions the agent must explore:**
- Which fiscal documents are required? (NF-e, NFS-e, CT-e, MDF-e...)
- Tax regime — Simples Nacional, Lucro Presumido, Lucro Real? (Brazil)
- SPED obligations applicable?
- Integration with existing fiscal provider or built-in transmission?
- Multi-CNPJ or single fiscal establishment?

**Integrates with:** HDM-01 (Financial), HDM-02 (Purchasing — inbound),
HDM-05 (Sales — outbound), HDM-13 (Fixed Assets)

**Country variation:** extreme — each country is a separate plugin
implementation. Brazil is the most complex fiscal environment globally.

---

### HDM-13 · Fixed Assets — Accounting

**Folder:** `/hdm/fixed-assets/`

**Description:** Accounting-side control of capital assets — acquisition,
depreciation calculation, revaluation, transfer, and disposal. Feeds the
general ledger with depreciation entries. Distinct from HDM-04 Asset
Management (physical control) — this module focuses on the accounting and
tax treatment of assets. Both can coexist and share the same asset records.

**Relevant for:** any company with capital goods that must be depreciated for
accounting or tax purposes.

**Key decisions the agent must explore:**
- Accounting depreciation only or also fiscal (tax) depreciation?
- Which depreciation methods — straight-line, declining balance?
- Asset revaluation required (IFRS)?
- Integration with HDM-04 for physical asset records?
- Disposal — sale, write-off, or donation?

**Integrates with:** HDM-01 (Financial — GL entries), HDM-04 (Asset Mgmt),
HDM-12 (Fiscal)

**Country variation:** medium — depreciation methods are partly standardized
by IFRS; tax depreciation rates are entirely country-specific.

---

### HDM-14 · Quality Management — QMS

**Folder:** `/hdm/quality/`

**Description:** Manages quality control processes — non-conformance records
(NCR), corrective and preventive actions (CAPA), inspection checklists,
supplier quality evaluation, and quality KPIs. Supports ISO 9001 compliance
workflows. Can be triggered at goods receipt (inbound quality), production
(in-process), or delivery (outbound).

**Relevant for:** manufacturers, distributors, healthcare, food industry,
and any business pursuing quality certification.

**Key decisions the agent must explore:**
- Which inspection points — inbound, in-process, outbound, or all?
- NCR workflow — who opens, who approves, who closes?
- CAPA (corrective action) tracking needed?
- Supplier quality scoring integration with purchasing?
- ISO 9001 or other certification compliance required?

**Integrates with:** HDM-02 (Purchasing — inbound quality), HDM-06
(Manufacturing — in-process), HDM-05 (Sales — outbound)

**Country variation:** low — quality management standards (ISO) are global.
Sector-specific regulations (ANVISA in Brazil, FDA in US) add local variation.

---

### HDM-15 · Workflow and Approvals

**Folder:** `/hdm/workflow/`

**Description:** Generic approval engine usable by any module. Defines
approval chains with multiple levels, conditions (by value, category,
department), deadlines, escalation rules, and delegation. A purchase order
above R$10,000 goes to the manager; above R$50,000 also to the director.
Built as infrastructure — modules declare which events trigger approval flows
and the engine handles routing, notification, and status tracking.

**Relevant for:** any business with approval policies — purchasing,
expense reports, time-off requests, contract signing, credit limits.

**Key decisions the agent must explore:**
- Approval by value threshold, by category, or both?
- Single approver or parallel multi-approver per level?
- Delegation rules when approver is absent?
- Deadline and escalation — what happens if not approved in time?
- Mobile approval required?

**Integrates with:** HDM-02 (Purchasing), HDM-05 (Sales — discounts),
HDM-07 (HR — time-off), HDM-09 (Expense reports), any module that needs
authorization gates.

**Country variation:** low — approval logic is universal.

---

### HDM-16 · Document Management — DMS

**Folder:** `/hdm/dms/`

**Description:** Manages structured documents with lifecycle — contracts,
policies, procedures, certificates. Each document has a version history,
an approval workflow before publication, an expiry date, and access control.
Distinct from the MDM Attachment infrastructure (which is a simple file
link) — DMS adds versioning, approval, expiry alerting, and controlled
distribution.

**Relevant for:** companies with contracts, compliance documents, quality
procedures, or any document that must be approved before use and monitored
for expiry.

**Key decisions the agent must explore:**
- Which document categories — contracts, procedures, certificates?
- Approval before publication — who approves each category?
- Expiry alerts — how far in advance, who is notified?
- Version control — can old versions be accessed?
- Access control — who can see which document category?

**Integrates with:** HDM-15 (Workflow — approval before publication),
HDM-14 (Quality — procedures and certificates), MDM (Attachment —
underlying file storage)

**Country variation:** low — document management process is universal;
legal retention periods vary per country.

---

### HDM-17 · Project Management

**Folder:** `/hdm/project/`

**Description:** Plans and tracks projects, tasks, milestones, resource
allocation, timesheets, budgets, and project-based billing. Essential for
service companies (consulting, agencies, IT firms, engineering) where
revenue and cost are tracked at the project level. Supports Agile
(sprints, backlog) and Waterfall (phases, Gantt) methodologies.

**Relevant for:** service companies, construction, engineering, consulting,
agencies — any business that delivers work organized as projects.

**Key decisions the agent must explore:**
- Methodology — Agile sprints, Waterfall phases, or hybrid?
- Timesheet per task or per project only?
- Project budget control — alert when over budget?
- Project-based billing — fixed price, time-and-materials, or milestone?
- Resource allocation across multiple simultaneous projects?

**Integrates with:** HDM-01 (Financial — project cost and revenue),
HDM-07 (HR — resource allocation), HDM-05 (Sales — project invoicing)

**Country variation:** low — project management methodology is universal.

---

### HDM-18 · Expense Reports

**Folder:** `/hdm/expenses/`

**Description:** Manages employee expense reimbursement — travel, meals,
fuel, accommodation. Employees submit expenses with receipts, managers
approve, finance reimburses. Supports per-diem policies, expense limits
by category, and integration with corporate card reconciliation.

**Relevant for:** any business with employees who incur expenses on behalf
of the company — sales teams, field technicians, frequent travelers.

**Key decisions the agent must explore:**
- Per-diem policy or actual expense reimbursement?
- Category limits — max per meal, per hotel night?
- Receipt required for all amounts or only above threshold?
- Corporate card reconciliation needed?
- Integration with travel booking?

**Integrates with:** HDM-01 (Financial — reimbursement), HDM-07 (HR),
HDM-15 (Workflow — approval)

**Country variation:** low for process; medium for tax treatment of
reimbursements (per-diem tax rules vary per country).

---

### HDM-19 · Supply Chain — SCM

**Folder:** `/hdm/scm/`

**Description:** Extends purchasing and inventory with demand planning,
supplier collaboration, transport management, and end-to-end supply chain
visibility. Covers demand forecasting, replenishment planning, carrier
management, freight tracking, and import/export logistics. More relevant
for distributors, importers, and manufacturers with complex supply chains.

**Relevant for:** distributors, importers, manufacturers with multi-supplier
or multi-warehouse complexity.

**Key decisions the agent must explore:**
- Demand forecasting needed or reactive replenishment only?
- Transport management — own fleet or third-party carriers?
- Import operations — customs, drawback, SISCOMEX? (Brazil)
- Multi-warehouse replenishment and transfer orders?
- Supplier portal for collaborative order confirmation?

**Integrates with:** HDM-02 (Purchasing), HDM-03 (Inventory),
HDM-12 (Fiscal — import documents)

**Country variation:** medium for domestic logistics; high for international
trade (customs regulations and e-documents are entirely country-specific).

---

### HDM-20 · Business Intelligence — BI

**Folder:** `/hdm/bi/`

**Description:** Cross-module analytics layer. Consolidates data from all
active modules into dashboards, KPI panels, and ad-hoc reports. Does not
store operational data — reads from module tables via read-optimized views
or a lightweight data mart. Provides the management layer that makes all
other modules useful to decision-makers.

**Relevant for:** any business that wants consolidated visibility across
modules — especially when more than three HDM modules are active.

**Key decisions the agent must explore:**
- Which KPIs are most important to the owner or manager?
- Real-time dashboard or end-of-day reports?
- Data export needed (Excel, PDF)?
- Role-based visibility — managers see all, supervisors see their area?
- Alerts — notify when KPI crosses threshold?

**Integrates with:** all active HDM modules (read-only)

**Country variation:** none — analytics logic is universal.

---

## Quick Reference — Module Selection by Business Type

| Business type | Likely core modules | Common additions |
|---|---|---|
| Petshop / veterinary | 03, 05, 08, 12 | 02, 01, 18 |
| Pharmacy / drugstore | 03, 05, 12, 14 | 02, 01, 08 |
| Furniture manufacturer | 03, 06, 02, 12 | 04, 11, 14, 01 |
| Distributor / wholesale | 02, 03, 05, 12, 19 | 01, 08, 15 |
| Consulting / agency | 17, 07, 08, 01 | 18, 15, 09 |
| Construction | 02, 03, 17, 04 | 01, 11, 07, 09 |
| Industry (general) | 02, 03, 06, 12, 01 | 04, 11, 14, 07, 09 |
| Retail (single store) | 03, 05, 12, 01 | 02, 08 |
| Healthcare clinic | 08, 01, 07 | 12, 15, 16 |
| Law firm | 17, 01, 07 | 08, 18, 16 |

Numbers refer to HDM module IDs above.

---

## Key Principles for the Agent

- Always suggest modules the user did not mention — use the Quick Reference
  table as a starting point but adapt to what the user describes.
- Never assume a module is not needed — ask before excluding.
- Present modules in plain business language, not technical names.
- The goal of the first conversation is scope confirmation, not
  implementation detail. Detail comes after the user confirms which
  modules to include.
- Clarification questions in each module's `skill-hdm.md` are a direction,
  not a script. The agent should adapt questions to what the user reveals
  during the conversation.
- A business that seems simple often needs more modules than it appears.
  A pet shop with deliveries needs logistics. A pharmacy with employees
  needs HR and payroll. Always probe for the full operation.
