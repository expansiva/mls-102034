/// <mls fileReference="_102034_/l4/ontology/mdm.defs.ts" enhancement="_blank"/>
/**
 * The level-1 ontology of the platform, in one file, meant to be read from start to finish.
 *
 * A record is `{ id, version, details }`, mirroring `mdm_documents`. `details` is a map of branches, and
 * every record has the same five:
 *
 *   identification  also columns of the index table — that is what makes them filterable and sortable
 *   base            what every record has, whatever its subtype
 *   <subtype>       exactly one per record, keyed by the subtype name with a lowercase first letter:
 *                   "person", "company", "assetVehicle". Its fields come from subtypes.<S>.fields
 *   general         the organization layer: what more than one module needed, so it was promoted
 *   <moduleId>      one key per module — only that module writes it, the others read it by name
 *
 * An example document, which is the target shape:
 *
 *   {
 *     "identification": { "name": "Maria", "docType": "CPF", "docId": "…", "countryCode": "BR",
 *                         "status": "Active", "tags": ["agendaClinica.Paciente"] },
 *     "base":           { "aliases": [], "addresses": [ … ], "contacts": [ … ], "relationshipRefs": { … } },
 *     "person":         { "birthDate": "1990-01-01", "privacyConsent": { … } },
 *     "general":        { },
 *     "agendaClinica":  { "prontuario": "PR-000123" }
 *   }
 *
 * The engine stores this document FLAT today; the branches are the target. That gap, and every other one
 * between this file and the engine, is in `knownDivergences` at the bottom — listed, not hidden.
 *
 * Reading a field: only what differs from the default is written. Absent means `required: false`,
 * `nullable: false`, title equal to the id, and origin level 1. The layer is not written either, because
 * the branch gives it: `identification` is a column, everything else lives in the document.
 *
 * Everything below the `export const` is ONE JSON literal, double-quoted, with no comments inside it, so
 * that the same extractor the screens and the agents use (`extractNs4ClassicJsonObject` + `JSON.parse`)
 * reads it whole. The ids that cross-reference each other — a capability of a subtype, an `of`, a `to` —
 * are checked by `l1/mdm/defs/mdmOntology.test.ts`, which imports this file.
 */

import type { MdmOntology } from '/_102034_/l1/mdm/defs/ontologyTypes.js';

export const mdm = {
  "schemaVersion": "2026-09-15-mdm-ontology-v2",

  "record": {
    "fields": {
      "id": { "type": "uuid", "required": true, "derived": true, "indexed": true, "description": "mdmId; stable through promotion and merge." },
      "version": { "type": "integer", "required": true, "derived": true, "description": "Bumped by the engine on every write; optimistic concurrency." },
      "details": { "type": "object", "required": true, "groups": ["identification", "base", "<subtype>", "general", "<moduleId>"], "description": "The JSONB document, as a map of groups (see groups)." }
    },
    "displayField": "identification.name"
  },

  "groups": {
    "identification": {
      "type": "object",
      "owner": "platform",
      "description": "Also columns of the index table; that is what makes them filterable and sortable. A field earns a column only when something has to filter or sort by it.",
      "fields": {
        "subtype": { "type": "enum", "required": true, "derived": true, "indexed": true, "values": ["Person", "Company", "ContactChannel", "Animal", "Product", "Service", "Location", "BankAccount", "Document", "AssetGeneric", "AssetVehicle", "AssetProperty", "AssetEquipment"], "description": "Which subtype this record is; it decides which subtype branch the document carries." },
        "name": { "type": "string", "required": true, "indexed": true, "maxLength": 200, "description": "How a human recognises the record. The only text filter there is." },
        "status": { "type": "enum", "required": true, "derived": true, "indexed": true, "values": ["Active", "Inactive", "Merged", "Blocked"] },
        "docType": { "type": "enum", "indexed": true, "values": ["SSN", "EIN", "Passport", "DriversLicense", "NationalId", "CPF", "CNPJ", "VAT", "Other"] },
        "docId": { "type": "string", "indexed": true, "description": "The document number itself. Unique with docType by design; the unique index does not exist yet, see knownDivergences." },
        "countryCode": { "type": "string", "required": true, "indexed": true, "maxLength": 2, "pattern": "^[A-Z]{2}$", "default": "US", "description": "ISO 3166-1 alpha-2. Says which country the document and the legal rules belong to." },
        "tags": { "type": "string", "collection": true, "required": true, "derived": true, "description": "Module roles, as <moduleId>.<Entity>. Written by attachRole; this is how a module says the record is one of its own. A column with no index." },
        "mergedInto": { "type": "string", "derived": true, "description": "On the loser of a merge, the mdmId of the winner. A column with no index." },
        "createdAt": { "type": "string", "required": true, "derived": true, "indexed": true },
        "updatedAt": { "type": "string", "required": true, "derived": true, "indexed": true }
      }
    },
    "base": {
      "type": "object",
      "owner": "platform",
      "description": "What every record has, whatever its subtype, and which nothing filters by.",
      "fields": {
        "moduleTypes": { "type": "string", "collection": true, "derived": true, "description": "The module roles again, kept for the engine and duplicating tags. Not a field for a reader; read tags." },
        "aliases": { "type": "string", "collection": true, "required": true, "description": "Other names the same subject answers to: trade name, maiden name, nickname." },
        "addresses": { "type": "object", "of": "Address", "collection": true, "required": true },
        "contacts": { "type": "object", "of": "ContactSummary", "collection": true, "required": true, "derived": true, "description": "Summary of the ContactChannel records linked by HasContact. A contact is a record, never a string on this one." },
        "relationshipRefs": { "type": "object", "required": true, "derived": true, "description": "The compact keys the engine recomputes on every link and unlink. The key set is relationships[].compactKeys — it is not repeated here, and it is never written by hand." },
        "notes": { "type": "string", "maxLength": 1000 }
      }
    },
    "general": {
      "type": "object",
      "owner": "organization",
      "open": true,
      "description": "Fields promoted by the organization when more than one module needed them; the schema lives in the project registry, so a module reads this branch and does not declare it."
    },
    "<moduleId>": {
      "type": "object",
      "owner": "module",
      "open": true,
      "description": "One key per module id — Record<moduleId, object>. Only that module writes it (MDM_FOREIGN_NAMESPACE otherwise); other modules see the key by name. Never identity, document, contact or login. Example: \"agendaClinica\": { \"prontuario\": \"PR-000123\" } — its schema is the module's own ontology (Paciente.defs.ts)."
    }
  },

  "types": {
    "Address": {
      "type": { "type": "enum", "required": true, "values": ["Residential", "Commercial", "Billing", "Delivery", "Other"] },
      "label": { "type": "string" },
      "line1": { "type": "string", "required": true },
      "line2": { "type": "string" },
      "line3": { "type": "string" },
      "city": { "type": "string" },
      "stateOrProvince": { "type": "string", "description": "State, province, prefecture or canton. In the US, the 2-letter code." },
      "postalCode": { "type": "string", "description": "ZIP, postcode, CEP, PIN. The format varies by country and the platform does not enforce one." },
      "countryCode": { "type": "string", "required": true, "maxLength": 2, "pattern": "^[A-Z]{2}$", "default": "US", "description": "ISO 3166-1 alpha-2. Drives how the address is formatted on screen." },
      "formatted": { "type": "string", "derived": true, "description": "The whole address on one line, as it would appear on an envelope. Built asynchronously." },
      "geolocation": { "type": "object", "of": "GeoPoint" },
      "isPrimary": { "type": "boolean", "required": true }
    },
    "GeoPoint": {
      "lat": { "type": "number", "required": true, "min": -90, "max": 90 },
      "lng": { "type": "number", "required": true, "min": -180, "max": 180 }
    },
    "PrivacyConsent": {
      "consentedAt": { "type": "timestamp", "required": true },
      "consentVersion": { "type": "string", "required": true },
      "channel": { "type": "string", "required": true, "description": "Where the consent was given: web form, paper, phone." },
      "revokedAt": { "type": "timestamp" },
      "notes": { "type": "string" }
    },
    "ContactSummary": {
      "mdmId": { "type": "uuid", "required": true, "description": "The ContactChannel record itself." },
      "title": { "type": "string", "required": true }
    }
  },

  "subtypes": {
    "Person": {
      "description": "Natural persons: customers, employees, partners, dependents.",
      "fields": {
        "birthDate": { "type": "date" },
        "gender": { "type": "enum", "values": ["Male", "Female", "NonBinary", "NotDisclosed"] },
        "nationality": { "type": "string", "maxLength": 2, "pattern": "^[A-Z]{2}$", "description": "ISO 3166-1 alpha-2 country of nationality." },
        "occupation": { "type": "string", "maxLength": 120 },
        "photoUrl": { "type": "string" },
        "privacyConsent": { "type": "object", "of": "PrivacyConsent", "description": "Required for residents of Brazil (LGPD) and the EU (GDPR)." }
      },
      "capabilities": ["locate.byLogin", "invite.login", "export.personalData", "anonymize"],
      "rules": ["rule-person-ssn-unique-for-us", "rule-person-privacy-consent-required-br-eu"]
    },
    "Company": {
      "description": "Corporations, LLCs, nonprofits, government entities — and the internal structures of any of them.",
      "fields": {
        "companyKind": { "type": "enum", "required": true, "values": ["LegalEntity", "Branch", "Franchise", "BusinessUnit", "Group", "Team", "Department", "InternalOrg"], "description": "Tells a legal entity apart from an internal structure." },
        "legalName": { "type": "string", "required": true, "description": "Official registered name." },
        "tradeName": { "type": "string", "description": "DBA name. Also goes into aliases, so the text filter finds it." },
        "legalType": { "type": "enum", "values": ["Corporation", "LLC", "SoleProp", "Partnership", "Nonprofit", "Government", "Other"] },
        "parentCompanyId": { "type": "record", "to": ["Company"], "description": "Parent in an organizational tree. The link itself is BelongsToGroup, PartOfUnit or SubsidiaryOf." },
        "externalCode": { "type": "string", "description": "ERP, HR or legacy code used by the consuming modules." },
        "foundingDate": { "type": "date" },
        "taxRegime": { "type": "string", "description": "Country-specific tax class: S-Corp and C-Corp in the US, Simples Nacional in Brazil." },
        "industryCode": { "type": "string", "description": "NAICS in the US, CNAE in Brazil, or the local equivalent." },
        "website": { "type": "string" }
      },
      "rules": ["rule-company-ein-unique-for-us", "rule-company-legal-name-required"]
    },
    "ContactChannel": {
      "description": "A phone, e-mail or social handle as a record of its own, so it can be traced, verified and shared.",
      "fields": {
        "contactType": { "type": "enum", "required": true, "values": ["Phone", "Email", "WhatsApp", "Instagram", "LinkedIn", "X", "Other"] },
        "value": { "type": "string", "required": true, "description": "The contact itself, stored unmasked." },
        "isVerified": { "type": "boolean", "required": true },
        "verifiedAt": { "type": "timestamp" }
      },
      "rules": ["rule-contact-value-unique-per-type"]
    },
    "Animal": {
      "description": "Pets, livestock, working animals.",
      "fields": {
        "species": { "type": "string" },
        "breed": { "type": "string" },
        "birthDate": { "type": "date" },
        "sex": { "type": "enum", "values": ["Male", "Female", "Unknown"] },
        "color": { "type": "string" },
        "microchip": { "type": "string" },
        "registrationNumber": { "type": "string", "description": "Breed registry, USDA tag, or official animal id." },
        "isNeutered": { "type": "boolean" }
      }
    },
    "Product": {
      "description": "An inventory or catalog item that can be bought, stocked, sold or offered by suppliers.",
      "fields": {
        "sku": { "type": "string", "description": "Internal stock keeping unit." },
        "productType": { "type": "enum", "values": ["Physical", "Digital", "Bundle", "Consumable", "Other"] },
        "category": { "type": "string" },
        "brand": { "type": "string" },
        "unitOfMeasure": { "type": "string", "description": "unit, box, kg, liter, hour." },
        "isInventoried": { "type": "boolean", "description": "True when stock is tracked by location." }
      }
    },
    "Service": {
      "description": "A reusable service or offering that can be sold, scheduled, taught or assigned to a place. Courses are services too.",
      "fields": {
        "serviceCode": { "type": "string" },
        "serviceKind": { "type": "enum", "values": ["Service", "Course", "Cohort", "Subscription", "AppointmentType"], "description": "Cohort is a concrete instance of a course." },
        "serviceType": { "type": "enum", "values": ["Course", "Consulting", "Maintenance", "Appointment", "Subscription", "Other"] },
        "parentServiceId": { "type": "record", "to": ["Service"], "description": "The base service, when this one is a cohort or a derived offering." },
        "durationMinutes": { "type": "number" },
        "deliveryMode": { "type": "enum", "values": ["Onsite", "Remote", "Hybrid", "Other"] }
      }
    },
    "Location": {
      "description": "A physical place used for stock or for delivering a service: room, warehouse, campus, store, branch, shelf.",
      "fields": {
        "locationType": { "type": "enum", "required": true, "values": ["Room", "Warehouse", "Building", "Campus", "Store", "Office", "Shelf", "Other"] },
        "locationCode": { "type": "string" },
        "parentLocationId": { "type": "record", "to": ["Location"], "description": "The larger place this one belongs to." },
        "capacity": { "type": "number" },
        "propertyAddress": { "type": "object", "of": "Address" }
      }
    },
    "BankAccount": {
      "description": "Routing data only. Balances and transactions belong to the finance module, never here.",
      "fields": {
        "bankName": { "type": "string" },
        "bankRoutingNumber": { "type": "string", "description": "ABA routing number in the US; use swift for international." },
        "accountNumber": { "type": "string" },
        "accountType": { "type": "enum", "values": ["Checking", "Savings", "MoneyMarket", "Payment", "Other"] },
        "swift": { "type": "string", "description": "BIC/SWIFT, for international transfers." },
        "iban": { "type": "string" },
        "pixKey": { "type": "string" },
        "pixKeyType": { "type": "enum", "values": ["CPF", "CNPJ", "Phone", "Email", "RandomKey"] },
        "isVerified": { "type": "boolean", "required": true, "description": "Verified by micro-deposit, open banking or manual review." }
      },
      "rules": ["rule-bank-account-holder-via-relationship", "rule-bank-account-routing-required-for-us"]
    },
    "Document": {
      "description": "An indexed reference to an external file. The file itself never lives in the MDM.",
      "fields": {
        "originModule": { "type": "string", "required": true, "description": "The module that created this record." },
        "docCategory": { "type": "enum", "required": true, "values": ["Contract", "Certificate", "IdDocument", "Invoice", "Receipt", "Report", "Photo", "Other"] },
        "storageBucket": { "type": "string", "required": true, "description": "S3 bucket, or its equivalent, holding the file." },
        "storagePath": { "type": "string", "required": true, "description": "Path inside the bucket. Never rewritten after creation." },
        "fileName": { "type": "string", "required": true },
        "mimeType": { "type": "string" },
        "fileSizeKb": { "type": "number" },
        "issuedAt": { "type": "date" },
        "expiresAt": { "type": "date" },
        "issuer": { "type": "string", "description": "Name of the issuing authority, as free text. Not an mdmId." }
      },
      "rules": ["rule-document-parties-via-relationships", "rule-document-path-immutable"]
    },
    "AssetGeneric": {
      "description": "The fallback asset, for what does not fit vehicle, property or equipment cleanly.",
      "fields": {
        "assetCategory": { "type": "string", "description": "furniture, lab-item, signage, toolkit, decor." },
        "serialNumber": { "type": "string" },
        "manufacturer": { "type": "string" },
        "model": { "type": "string" }
      }
    },
    "AssetVehicle": {
      "description": "Cars, trucks, motorcycles, boats.",
      "fields": {
        "plate": { "type": "string" },
        "vin": { "type": "string", "description": "Vehicle Identification Number." },
        "brand": { "type": "string" },
        "model": { "type": "string" },
        "year": { "type": "integer" },
        "color": { "type": "string" },
        "fuelType": { "type": "enum", "values": ["Gasoline", "Diesel", "Electric", "Hybrid", "Flex", "Other"] }
      }
    },
    "AssetProperty": {
      "description": "Real estate: residential, commercial, rural or industrial.",
      "fields": {
        "registrationNumber": { "type": "string", "description": "Deed number, cadastral reference, or the local equivalent." },
        "propertyAddress": { "type": "object", "of": "Address" },
        "propertyType": { "type": "enum", "values": ["Residential", "Commercial", "Rural", "UrbanLot", "Industrial", "Other"] },
        "areaSqft": { "type": "number", "description": "Area in square feet; the primary unit in the US." },
        "areaM2": { "type": "number", "description": "Area in square meters, outside the US." },
        "taxParcelId": { "type": "string", "description": "Tax parcel or assessor id in the US, or the local equivalent." }
      }
    },
    "AssetEquipment": {
      "description": "Machinery, devices, infrastructure equipment.",
      "fields": {
        "serialNumber": { "type": "string" },
        "brand": { "type": "string" },
        "model": { "type": "string" },
        "category": { "type": "string" },
        "acquisitionDate": { "type": "date" }
      }
    }
  },

  "relationships": [
    { "type": "Owns", "title": "Owns", "description": "A person or a company owns an asset · metadata: since, ownershipPct", "from": ["Person", "Company"], "to": ["AssetGeneric", "AssetVehicle", "AssetProperty", "AssetEquipment"], "bidirectional": false, "roles": [], "compactKeys": { "from": ["ownedAssets"], "to": ["owners"] } },
    { "type": "Employs", "title": "Employs", "description": "A company employs a person · metadata: role, department, startDate", "from": ["Company"], "to": ["Person"], "bidirectional": false, "roles": ["employee", "contractor", "intern"], "compactKeys": { "from": ["employees"], "to": ["employers"] } },
    { "type": "OffersProduct", "title": "Offers product", "description": "A company puts a product in its catalog · metadata: since, supplierSku", "from": ["Company"], "to": ["Product"], "bidirectional": false, "roles": [], "compactKeys": { "from": ["offeredProducts"], "to": ["productSuppliers"] } },
    { "type": "OffersService", "title": "Offers service", "description": "A company or a person offers a service · metadata: since, priceTable", "from": ["Company", "Person"], "to": ["Service"], "bidirectional": false, "roles": [], "compactKeys": { "from": ["offeredServices"], "to": ["serviceProviders"] } },
    { "type": "StocksAt", "title": "Stocks at", "description": "A product or a piece of equipment is stocked at a place · metadata: quantity, unit, minLevel", "from": ["Product", "AssetEquipment"], "to": ["Location"], "bidirectional": false, "roles": [], "compactKeys": { "from": ["stockLocations"], "to": ["stockedItems"] } },
    { "type": "Teaches", "title": "Teaches", "description": "A person teaches a service or a course · metadata: role, since", "from": ["Person"], "to": ["Service"], "bidirectional": false, "roles": ["primary-instructor", "assistant-instructor", "substitute"], "compactKeys": { "from": ["taughtServices"], "to": ["instructors"] } },
    { "type": "HappensAt", "title": "Happens at", "description": "A service is delivered at a place · metadata: scheduleLabel, weekday", "from": ["Service"], "to": ["Location"], "bidirectional": false, "roles": [], "compactKeys": { "from": ["serviceLocations"], "to": ["scheduledServices"] } },
    { "type": "FranchiseOf", "title": "Franchise of", "description": "A company operates as a franchise of another · metadata: contractId, territory", "from": ["Company"], "to": ["Company"], "bidirectional": false, "roles": [], "compactKeys": { "from": ["franchisors"], "to": ["franchisees"] } },
    { "type": "BelongsToGroup", "title": "Belongs to group", "description": "A company belongs to an economic group · metadata: role", "from": ["Company"], "to": ["Company"], "bidirectional": false, "roles": ["subsidiary-brand"], "compactKeys": { "from": ["groupParents"], "to": ["groupMembers"] } },
    { "type": "PartOfUnit", "title": "Part of unit", "description": "An internal structure belongs to a larger one · metadata: role", "from": ["Company"], "to": ["Company"], "bidirectional": false, "roles": ["department", "team", "branch-unit"], "compactKeys": { "from": ["unitParents"], "to": ["unitChildren"] } },
    { "type": "ManagedBy", "title": "Managed by", "description": "A person runs a company or a service · metadata: role", "from": ["Person"], "to": ["Company", "Service"], "bidirectional": false, "roles": ["manager", "coordinator"], "compactKeys": { "from": ["managedOrganizations"], "to": ["managers"] } },
    { "type": "ReportsTo", "title": "Reports to", "description": "A person reports to another person · metadata: role", "from": ["Person"], "to": ["Person"], "bidirectional": false, "roles": ["direct-report", "manager"], "compactKeys": { "from": ["reportManagers"], "to": ["reports"] } },
    { "type": "AssignedTo", "title": "Assigned to", "description": "A person is assigned to a company or a service · metadata: role", "from": ["Person"], "to": ["Company", "Service"], "bidirectional": false, "roles": ["member", "assistant", "instructor"], "compactKeys": { "from": ["assignments"], "to": ["assignees"] } },
    { "type": "Attends", "title": "Attends", "description": "A person attends a service or a course · metadata: attendanceStatus", "from": ["Person"], "to": ["Service"], "bidirectional": false, "roles": ["enrolled", "completed"], "compactKeys": { "from": ["attendedServices"], "to": ["attendees"] } },
    { "type": "SuppliesProduct", "title": "Supplies product", "description": "A company supplies a product · metadata: leadTimeDays, catalogCode", "from": ["Company"], "to": ["Product"], "bidirectional": false, "roles": [], "compactKeys": { "from": ["suppliedProducts"], "to": ["productVendors"] } },
    { "type": "PartnersWith", "title": "Partners with", "description": "A person is a partner in a company · metadata: equityPct, role", "from": ["Person"], "to": ["Company"], "bidirectional": false, "roles": ["managing-partner", "silent-partner"], "compactKeys": { "from": ["partners"], "to": ["partners"] } },
    { "type": "Family", "title": "Family", "description": "Kinship between two people, read the same way from either side · metadata: degree. An emergency contact is this link with role emergency", "from": ["Person"], "to": ["Person"], "bidirectional": true, "roles": ["spouse", "child", "parent", "sibling", "emergency"], "compactKeys": { "from": ["family"], "to": ["family"] } },
    { "type": "GuardianOf", "title": "Guardian of", "description": "A person answers for another person or for an animal · metadata: since, guardianType", "from": ["Person"], "to": ["Person", "Animal"], "bidirectional": false, "roles": ["parent", "guardian", "owner", "foster"], "compactKeys": { "from": ["pets"], "to": ["guardians"] } },
    { "type": "CustomerOf", "title": "Customer of", "description": "A person or a company buys from a company · metadata: since, segment", "from": ["Person", "Company"], "to": ["Company"], "bidirectional": false, "roles": [], "compactKeys": { "from": ["suppliers"], "to": ["customers"] } },
    { "type": "SupplierOf", "title": "Supplier of", "description": "A company supplies another company · metadata: category, contractMdmId", "from": ["Company"], "to": ["Company"], "bidirectional": false, "roles": [], "compactKeys": { "from": ["customers"], "to": ["suppliers"] } },
    { "type": "MemberOf", "title": "Member of", "description": "A person is a member of a company or an association · metadata: role, membershipType", "from": ["Person"], "to": ["Company"], "bidirectional": false, "roles": ["board-member", "honorary"], "compactKeys": { "from": ["memberships"], "to": ["members"] } },
    { "type": "HoldsAccount", "title": "Holds account", "description": "A person or a company holds a bank account · metadata: isPrimary, since", "from": ["Person", "Company"], "to": ["BankAccount"], "bidirectional": false, "roles": [], "compactKeys": { "from": ["bankAccounts"], "to": ["accountHolders"] } },
    { "type": "SubsidiaryOf", "title": "Subsidiary of", "description": "A company is a subsidiary of another · metadata: equityPct, type", "from": ["Company"], "to": ["Company"], "bidirectional": false, "roles": ["wholly-owned", "affiliate"], "compactKeys": { "from": ["parentCompanies"], "to": ["subsidiaries"] } },
    { "type": "LocatedAt", "title": "Located at", "description": "A person or a company sits at a property · metadata: locationType", "from": ["Person", "Company"], "to": ["AssetProperty"], "bidirectional": false, "roles": ["headquarters", "branch", "warehouse"], "compactKeys": { "from": ["locations"], "to": ["locatedEntities"] } },
    { "type": "Signed", "title": "Signed", "description": "A person or a company signed a document · metadata: role", "from": ["Person", "Company"], "to": ["Document"], "bidirectional": false, "roles": ["contractor", "client", "witness", "notary"], "compactKeys": { "from": ["documents"], "to": ["signedBy"] } },
    { "type": "HasContact", "title": "Has contact", "description": "Any record owns a contact channel; this is what fills base.contacts · metadata: isPrimary", "from": ["Person", "Company", "Product", "Service", "Location", "AssetGeneric", "AssetVehicle", "AssetProperty", "AssetEquipment", "Animal", "BankAccount", "Document", "ContactChannel"], "to": ["ContactChannel"], "bidirectional": false, "roles": [], "compactKeys": { "from": ["contacts"], "to": ["contactOwners"] } }
  ],

  "capabilities": {
    "read.byId": "Reads one record, or a handful at once, when the id is already known · get, getMany and hydrateMany over the index plus the document store, O(1) each · any screen that already holds the mdmId, and every list that has to fill in the records it points at · platform: ready",
    "locate.byName": "Finds records whose name contains the typed text, anywhere in the string · listByType narrows by subtype and status in the index table and then matches the name in memory; aliases are not consulted and there is no default page size · anyone looking a record up · platform: partial",
    "locate.byDocument": "Finds the single record that holds a national document (CPF, CNPJ, SSN, EIN) · findByDocument loads the index and filters in JS · whoever registers, to deduplicate before creating · platform: partial",
    "locate.byContact": "Finds the record that owns a phone, WhatsApp handle or e-mail · findByContact loads every ContactChannel record · whoever answers an inbound call or message · platform: partial",
    "locate.byLogin": "Finds the person behind a login e-mail · mdm_tag row with namespace login, partial unique index on (namespace, tag, module) · the session resolver · platform: ready",
    "locate.byTag": "Finds every record carrying a given label — which is how a secondary key works here · mdm.tag.findByTag, over the index idx_mdm_tag_lookup on (entityType, tag, module); the `namespace` column keeps one key space apart from another, and the login e-mail of locate.byLogin is nothing but the namespace 'login' · a module that has to find a record by a code of its own, such as a chart or a badge number · platform: ready",
    "locate.semantic": "Finds a record through a misspelling, a phonetic match or half a name · would need a trigram or tsvector index, or embeddings; searchVector is TEXT compared literally · reception, when the spelling is uncertain · platform: missing",
    "locate.byDocumentField": "Filters or sorts by something that lives only in the document, such as birth month, city or any module field · would need that field promoted to an index column, or a GIN index on details; for a key the module itself controls, locate.byTag already answers without any of that · marketing and reporting · platform: missing",
    "register.createOrAttach": "Creates the record when it does not exist and, either way, marks it with the module role · locate.byDocument, create when absent, then attachRole writes details[moduleId], the tag, the audit row and the recomputed compact refs · whoever registers · platform: ready",
    "register.asProspect": "Records an interested party who has no document yet, and promotes it later · prospect.create with promotionSource and ttlExpiresAt, then promoteToEntity keeping the same mdmId · reception and the public site · platform: ready",
    "edit.platformFields": "Changes the name, document, addresses, consent and the other fields the platform owns · entity.update; touching an identification field also rewrites the index row · whoever maintains the record · platform: partial",
    "edit.moduleNamespace": "Changes only details[moduleId], which is what this module knows about the record · attachRole or update carrying the module key; any other module key is refused · the module itself · platform: ready",
    "inactivate": "Takes the record out of use without deleting it · status Active to Inactive, and reactivate undoes it · whoever maintains the record · platform: partial",
    "merge": "Joins two records that are the same subject, the loser pointing at the winner · mergeEntity sets status Merged and mergedInto, but the facade neither exports nor routes it · an administrator · platform: missing",
    "delete": "Removes the record physically, and is refused while an active relationship exists · entity.delete, error MDM_DELETE_BLOCKED_BY_RELATIONSHIPS · an administrator · platform: ready",
    "link": "Creates a versioned relationship, with a role, between two permanent records · link(from, to, type, role); the engine recomputes the compact keys on both sides · whoever maintains the record · platform: ready",
    "unlink": "Closes a relationship while keeping its history · unlink sets status Inactive; the row is never deleted · whoever maintains the record · platform: ready",
    "link.contact": "Adds a phone, WhatsApp handle or e-mail that belongs to this record · create a ContactChannel record and link it with HasContact; the engine fills relationshipRefs.contacts · whoever maintains the record · platform: ready",
    "listLinks": "Shows the related records, with their validity and role · relationship.list and relatedOfMany · the record screen · platform: ready",
    "attach.document": "Stores a photo, a scan or a signed document against the record, by category · upload to S3 or local disk, a row in mdm_attachment, presigned GET · whoever maintains the record · platform: partial",
    "comment": "Leaves a note on the record, with one level of reply and a 15-minute edit window · mdm_comment anchored by entityType, entityId and module · whoever maintains the record · platform: ready",
    "tag": "Marks the record with free labels inside the module namespace · mdm_tag, unique on (entityType, entityId, tag, module) · whoever maintains the record · platform: ready",
    "sequence.next": "Issues the next number of a counter, such as a record or order number · mdm_number_sequence with SELECT … FOR UPDATE, key {module}.{entityType}.{scope} · the module, on create · platform: ready",
    "config.kv": "Keeps a small piece of JSON configuration that more than one module reads · mdm.kv.get and mdm.kv.put over mdm_kv, a shared table keyed by one `key` column — no per-record scope, no history and no module column · a module that needs a setting the others also read · platform: ready",
    "statusHistory.read": "Shows when the record changed status and who changed it · mdm_status_history · the record screen · platform: partial",
    "audit": "Says who changed what, and when · mdm_audit_log, insert only · an administrator · platform: partial",
    "invite.login": "Gives the person a login so they can see their own data · identity.invite writes the mdm_tag login row and calls collab-auth · whoever maintains the record · platform: ready",
    "export.personalData": "Hands the subject their own data on request (LGPD art. 18, GDPR art. 15) · would need the document, the links and the attachments in a single export · an administrator · platform: missing",
    "anonymize": "Erases the personal data while keeping the record for statistics · would pseudonymize the identification keeping the mdmId · an administrator · platform: missing"
  },

  "rules": {
    "rule-person-ssn-unique-for-us": "Two permanent people in the US must not share the same SSN · engine · platform: partial, because the unique index does not exist",
    "rule-person-privacy-consent-required-br-eu": "A person living in Brazil or the EU without a valid privacy consent is forced to Inactive · engine · platform: ready",
    "rule-company-ein-unique-for-us": "Two permanent companies in the US must not share the same EIN · engine · platform: partial, because the unique index does not exist",
    "rule-company-legal-name-required": "A company record is refused without a legalName · engine · platform: ready",
    "rule-contact-value-unique-per-type": "Two contact channels must not share the same contactType and value · engine · platform: partial",
    "rule-bank-account-routing-required-for-us": "A US bank account is refused without a bankRoutingNumber · engine · platform: ready",
    "rule-bank-account-holder-via-relationship": "Who holds a bank account is the HoldsAccount link, never a field of the account · engine · platform: ready",
    "rule-document-parties-via-relationships": "Who signed a document is the Signed link, never a field of the document · engine · platform: ready",
    "rule-document-path-immutable": "Once stored, the storage key of a document is never rewritten · engine · platform: ready",
    "rule-foreign-namespace-refused": "A caller carrying a moduleId may write the platform keys, general and its own key; any other module key is refused with MDM_FOREIGN_NAMESPACE · engine · platform: ready",
    "rule-delete-blocked-by-relationships": "A physical delete is refused while an active relationship exists · engine · platform: ready",
    "rule-document-shape-validated": "Addresses, consent, general and the module namespace are validated on write against the schema derived from this ontology · engine · platform: missing, nothing validates the document today",
    "rule-identity-never-in-namespace": "Identity, document, contact and login are platform layers; a module never redeclares them inside details[moduleId] · engine · platform: partial"
  },

  "statuses": ["Active", "Inactive", "Merged", "Blocked"],
  "docTypes": ["SSN", "EIN", "Passport", "DriversLicense", "NationalId", "CPF", "CNPJ", "VAT", "Other"],

  "storage": {
    "indexTable": "mdm_documents_entities_index",
    "prospectIndexTable": "mdm_documents_prospects_index",
    "documentTable": "mdm_documents",
    "documentColumn": "details",
    "indexedColumns": ["subtype", "name", "status", "docType", "docId", "countryCode", "createdAt", "updatedAt"],
    "reservedKeys": ["identification", "base", "general", "<subtype>", "<moduleId>"]
  },

  "knownDivergences": {
    "grouped-document": "The branches of this file are the target. The engine writes and reads a FLAT document today, so identification, base and the subtype branch are all one level.",
    "contacts-written-from-input": "base.contacts is declared derived from HasContact and the engine still writes it raw from the input, duplicating relationshipRefs.contacts.",
    "module-types-duplicates-tags": "base.moduleTypes and identification.tags carry the same module roles. tags is the one with a column; moduleTypes is kept for the engine and should disappear.",
    "doc-unique-missing": "UNIQUE(docType, docId) is promised in defs/ontology.ts and absent from persistence.ts, so the two uniqueness rules are only partly enforced.",
    "privacy-consent-value": "PrivacyConsent (data) and PrivacyConsentValue (interface) declare different fields; the same is true of Address and ContactSummary.",
    "compact-relationship-refs-count": "CompactRelationshipRefs has 22 keys in the data and 48 in the interface; the interface is the real one.",
    "search-vector-type": "searchVector is documented as tsvector and created as TEXT, compared literally, which is why locate.semantic is missing.",
    "relationship-documents-table": "Table mdm_relationship_documents is cited and does not exist.",
    "service-defs-case": "The JSON service definitions use PascalCase where the columns are camelCase.",
    "platform-detail-keys-copy": "The list of platform keys exists twice, in mdmFacade.ts and integration.ts, with different contents.",
    "emergency-contact-type": "There is no EmergencyContactOf type; a Family link with role emergency carries that meaning.",
    "subtype-enum-narrowed": "identification.subtype is declared here with the 13 values; the engine narrows it per subtype, so a Person record only ever carries \"Person\".",
    "index-only-columns": "The index table also has searchVector and dynamoPk, which are engine internals and no field of the document; one of the 9 indexes is on dynamoPk, which is why indexedColumns lists 8."
  }
} as const satisfies MdmOntology;

export default mdm;
