# skill-hdm.md — Fiscal Engine (HDM-12)

## Module summary
Electronic fiscal document generation and tax calculation. Core defines the
interface. Each country requires a dedicated plugin. Brazil is the most
complex globally.

## Clarification questions
- Which fiscal documents are required? (NF-e, NFS-e, CT-e, MDF-e for Brazil)
- Tax regime — Simples Nacional, Lucro Presumido, Lucro Real? (Brazil)
- Which SPED obligations apply? (EFD ICMS/IPI, EFD Contribuições, ECF)
- Multi-CNPJ or single fiscal establishment?
- Contingency mode needed for offline environments?
- Integration with existing fiscal provider (Mastersaf, Synchro) or built-in?

## Features
- core: fiscal document record, tax rate table, transmission status tracking
- plugin-nfe-brazil: NF-e emission, SEFAZ transmission, cancellation, DANFE
- plugin-nfse-brazil: NFS-e per municipality (ISS), RPS batch
- plugin-sped-brazil: EFD ICMS/IPI, EFD Contribuições, ECF generation
- plugin-cte-brazil: CT-e for transport companies
- plugin-cfdi-mexico: CFDI 4.0 SAT transmission

## KPIs
- Documents by status (authorized / rejected / pending)
- Rejection rate and most common rejection reasons
- Transmission latency (issued to authorized)
- Tax amount by type and period

## Mock orientation
Generate: 30 fiscal documents in various statuses (20 authorized, 5 pending,
3 rejected, 2 cancelled). Include realistic access keys and tax breakdowns.
