/// <mls fileReference="_102034_/l4/ontology/index.defs.ts" enhancement="_blank"/>

import type { InferRecord, MdmOntologyIndexArtifact } from '/_102034_/l1/mdm/defs/ontologyTypes.js';
import mdmValueTypeAddress from '/_102034_/l4/ontology/defs/Address.defs.js';
import mdmValueTypeGeoPoint from '/_102034_/l4/ontology/defs/GeoPoint.defs.js';
import mdmValueTypePrivacyConsent from '/_102034_/l4/ontology/defs/PrivacyConsent.defs.js';
import mdmValueTypeContactSummary from '/_102034_/l4/ontology/defs/ContactSummary.defs.js';
import mdmEntityPerson from '/_102034_/l4/ontology/Person.defs.js';
import mdmEntityCompany from '/_102034_/l4/ontology/Company.defs.js';
import mdmEntityProduct from '/_102034_/l4/ontology/Product.defs.js';
import mdmEntityService from '/_102034_/l4/ontology/Service.defs.js';
import mdmEntityLocation from '/_102034_/l4/ontology/Location.defs.js';
import mdmEntityAssetGeneric from '/_102034_/l4/ontology/AssetGeneric.defs.js';
import mdmEntityAssetVehicle from '/_102034_/l4/ontology/AssetVehicle.defs.js';
import mdmEntityAssetProperty from '/_102034_/l4/ontology/AssetProperty.defs.js';
import mdmEntityAssetEquipment from '/_102034_/l4/ontology/AssetEquipment.defs.js';
import mdmEntityAnimal from '/_102034_/l4/ontology/Animal.defs.js';
import mdmEntityBankAccount from '/_102034_/l4/ontology/BankAccount.defs.js';
import mdmEntityDocument from '/_102034_/l4/ontology/Document.defs.js';
import mdmEntityContactChannel from '/_102034_/l4/ontology/ContactChannel.defs.js';

export const mdmOntologyIndex = {
  "schemaVersion": "2026-09-15-mdm-ontology-v1",
  "title": "Platform level 1 — master data",
  "description": "What the organization keeps once and every module reuses. One document per record; identification fields are also index columns. A module never copies a record: it declares a role over the subtype and writes its own namespace.",
  "entities": [
    "Person",
    "Company",
    "Product",
    "Service",
    "Location",
    "AssetGeneric",
    "AssetVehicle",
    "AssetProperty",
    "AssetEquipment",
    "Animal",
    "BankAccount",
    "Document",
    "ContactChannel"
  ],
  "valueTypes": [
    "Address",
    "GeoPoint",
    "PrivacyConsent",
    "ContactSummary"
  ],
  "relationships": [
    {
      "type": "Owns",
      "title": "Owns",
      "description": "Metadata example: { since: \"2022-01-01\", ownershipPct: 100 }",
      "from": [
        "Person",
        "Company"
      ],
      "to": [
        "AssetGeneric",
        "AssetVehicle",
        "AssetProperty",
        "AssetEquipment"
      ],
      "bidirectional": false,
      "roles": [],
      "compactKeys": {
        "from": [
          "ownedAssets"
        ],
        "to": [
          "owners"
        ]
      }
    },
    {
      "type": "Employs",
      "title": "Employs",
      "description": "Metadata example: { role: \"Software Engineer\", department: \"Engineering\", startDate: \"2023-06-01\" }",
      "from": [
        "Company"
      ],
      "to": [
        "Person"
      ],
      "bidirectional": false,
      "roles": [
        "employee",
        "contractor",
        "intern"
      ],
      "compactKeys": {
        "from": [
          "employees"
        ],
        "to": [
          "employers"
        ]
      }
    },
    {
      "type": "OffersProduct",
      "title": "Offers Product",
      "description": "Metadata example: { since: \"2024-01-01\", supplierSku: \"CHAIR-01\" }",
      "from": [
        "Company"
      ],
      "to": [
        "Product"
      ],
      "bidirectional": false,
      "roles": [],
      "compactKeys": {
        "from": [
          "offeredProducts"
        ],
        "to": [
          "productSuppliers"
        ]
      }
    },
    {
      "type": "OffersService",
      "title": "Offers Service",
      "description": "Metadata example: { since: \"2024-01-01\", priceTable: \"default\" }",
      "from": [
        "Company",
        "Person"
      ],
      "to": [
        "Service"
      ],
      "bidirectional": false,
      "roles": [],
      "compactKeys": {
        "from": [
          "offeredServices"
        ],
        "to": [
          "serviceProviders"
        ]
      }
    },
    {
      "type": "StocksAt",
      "title": "Stocks At",
      "description": "Metadata example: { quantity: 20, unit: \"unit\", minLevel: 5 }",
      "from": [
        "Product",
        "AssetEquipment"
      ],
      "to": [
        "Location"
      ],
      "bidirectional": false,
      "roles": [],
      "compactKeys": {
        "from": [
          "stockLocations"
        ],
        "to": [
          "stockedItems"
        ]
      }
    },
    {
      "type": "Teaches",
      "title": "Teaches",
      "description": "Metadata example: { role: \"primary-instructor\", since: \"2026-03-01\" }",
      "from": [
        "Person"
      ],
      "to": [
        "Service"
      ],
      "bidirectional": false,
      "roles": [
        "primary-instructor",
        "assistant-instructor",
        "substitute"
      ],
      "compactKeys": {
        "from": [
          "taughtServices"
        ],
        "to": [
          "instructors"
        ]
      }
    },
    {
      "type": "HappensAt",
      "title": "Happens At",
      "description": "Metadata example: { scheduleLabel: \"Engineering 1 - morning\", weekday: \"Mon\" }",
      "from": [
        "Service"
      ],
      "to": [
        "Location"
      ],
      "bidirectional": false,
      "roles": [],
      "compactKeys": {
        "from": [
          "serviceLocations"
        ],
        "to": [
          "scheduledServices"
        ]
      }
    },
    {
      "type": "FranchiseOf",
      "title": "Franchise Of",
      "description": "Metadata example: { contractId: \"uuid\", territory: \"south-zone\" }",
      "from": [
        "Company"
      ],
      "to": [
        "Company"
      ],
      "bidirectional": false,
      "roles": [],
      "compactKeys": {
        "from": [
          "franchisors"
        ],
        "to": [
          "franchisees"
        ]
      }
    },
    {
      "type": "BelongsToGroup",
      "title": "Belongs To Group",
      "description": "Metadata example: { role: \"subsidiary-brand\" }",
      "from": [
        "Company"
      ],
      "to": [
        "Company"
      ],
      "bidirectional": false,
      "roles": [
        "subsidiary-brand"
      ],
      "compactKeys": {
        "from": [
          "groupParents"
        ],
        "to": [
          "groupMembers"
        ]
      }
    },
    {
      "type": "PartOfUnit",
      "title": "Part Of Unit",
      "description": "Metadata example: { role: \"department\" | \"team\" | \"branch-unit\" }",
      "from": [
        "Company"
      ],
      "to": [
        "Company"
      ],
      "bidirectional": false,
      "roles": [
        "department",
        "team",
        "branch-unit"
      ],
      "compactKeys": {
        "from": [
          "unitParents"
        ],
        "to": [
          "unitChildren"
        ]
      }
    },
    {
      "type": "ManagedBy",
      "title": "Managed By",
      "description": "Metadata example: { role: \"manager\" | \"coordinator\" }",
      "from": [
        "Person"
      ],
      "to": [
        "Company",
        "Service"
      ],
      "bidirectional": false,
      "roles": [
        "manager",
        "coordinator"
      ],
      "compactKeys": {
        "from": [
          "managedOrganizations"
        ],
        "to": [
          "managers"
        ]
      }
    },
    {
      "type": "ReportsTo",
      "title": "Reports To",
      "description": "Metadata example: { role: \"direct-report\" }",
      "from": [
        "Person"
      ],
      "to": [
        "Person"
      ],
      "bidirectional": false,
      "roles": [
        "direct-report",
        "manager"
      ],
      "compactKeys": {
        "from": [
          "reportManagers"
        ],
        "to": [
          "reports"
        ]
      }
    },
    {
      "type": "AssignedTo",
      "title": "Assigned To",
      "description": "Metadata example: { role: \"member\" | \"assistant\" | \"instructor\" }",
      "from": [
        "Person"
      ],
      "to": [
        "Company",
        "Service"
      ],
      "bidirectional": false,
      "roles": [
        "member",
        "assistant",
        "instructor"
      ],
      "compactKeys": {
        "from": [
          "assignments"
        ],
        "to": [
          "assignees"
        ]
      }
    },
    {
      "type": "Attends",
      "title": "Attends",
      "description": "Metadata example: { attendanceStatus: \"enrolled\" | \"completed\" }",
      "from": [
        "Person"
      ],
      "to": [
        "Service"
      ],
      "bidirectional": false,
      "roles": [
        "enrolled",
        "completed"
      ],
      "compactKeys": {
        "from": [
          "attendedServices"
        ],
        "to": [
          "attendees"
        ]
      }
    },
    {
      "type": "SuppliesProduct",
      "title": "Supplies Product",
      "description": "Metadata example: { leadTimeDays: 7, catalogCode: \"SUP-001\" }",
      "from": [
        "Company"
      ],
      "to": [
        "Product"
      ],
      "bidirectional": false,
      "roles": [],
      "compactKeys": {
        "from": [
          "suppliedProducts"
        ],
        "to": [
          "productVendors"
        ]
      }
    },
    {
      "type": "PartnersWith",
      "title": "Partners With",
      "description": "Metadata example: { equityPct: 30, role: \"managing-partner\" }",
      "from": [
        "Person"
      ],
      "to": [
        "Company"
      ],
      "bidirectional": false,
      "roles": [
        "managing-partner",
        "silent-partner"
      ],
      "compactKeys": {
        "from": [
          "partners"
        ],
        "to": [
          "partners"
        ]
      }
    },
    {
      "type": "Family",
      "title": "Family",
      "description": "Metadata example: { degree: \"spouse\" | \"child\" | \"parent\" | \"sibling\" }",
      "from": [
        "Person"
      ],
      "to": [
        "Person"
      ],
      "bidirectional": true,
      "roles": [
        "spouse",
        "child",
        "parent",
        "sibling",
        "emergency"
      ],
      "compactKeys": {
        "from": [
          "family"
        ],
        "to": [
          "family"
        ]
      }
    },
    {
      "type": "GuardianOf",
      "title": "Guardian Of",
      "description": "Metadata example: { since: \"2020-05-10\", guardianType: \"owner\" | \"foster\" }",
      "from": [
        "Person"
      ],
      "to": [
        "Person",
        "Animal"
      ],
      "bidirectional": false,
      "roles": [
        "parent",
        "guardian",
        "owner",
        "foster"
      ],
      "compactKeys": {
        "from": [
          "pets"
        ],
        "to": [
          "guardians"
        ]
      }
    },
    {
      "type": "CustomerOf",
      "title": "Customer Of",
      "description": "Metadata example: { since: \"2021-01-01\", segment: \"retail\" }",
      "from": [
        "Person",
        "Company"
      ],
      "to": [
        "Company"
      ],
      "bidirectional": false,
      "roles": [],
      "compactKeys": {
        "from": [
          "suppliers"
        ],
        "to": [
          "customers"
        ]
      }
    },
    {
      "type": "SupplierOf",
      "title": "Supplier Of",
      "description": "Metadata example: { category: \"raw-materials\", contractMdmId: \"uuid\" }",
      "from": [
        "Company"
      ],
      "to": [
        "Company"
      ],
      "bidirectional": false,
      "roles": [],
      "compactKeys": {
        "from": [
          "customers"
        ],
        "to": [
          "suppliers"
        ]
      }
    },
    {
      "type": "MemberOf",
      "title": "Member Of",
      "description": "Metadata example: { role: \"board-member\", membershipType: \"honorary\" }",
      "from": [
        "Person"
      ],
      "to": [
        "Company"
      ],
      "bidirectional": false,
      "roles": [
        "board-member",
        "honorary"
      ],
      "compactKeys": {
        "from": [
          "memberships"
        ],
        "to": [
          "members"
        ]
      }
    },
    {
      "type": "HoldsAccount",
      "title": "Holds Account",
      "description": "Metadata example: { isPrimary: true, since: \"2019-03-15\" }",
      "from": [
        "Person",
        "Company"
      ],
      "to": [
        "BankAccount"
      ],
      "bidirectional": false,
      "roles": [],
      "compactKeys": {
        "from": [
          "bankAccounts"
        ],
        "to": [
          "accountHolders"
        ]
      }
    },
    {
      "type": "SubsidiaryOf",
      "title": "Subsidiary Of",
      "description": "Metadata example: { equityPct: 100, type: \"wholly-owned\" | \"affiliate\" }",
      "from": [
        "Company"
      ],
      "to": [
        "Company"
      ],
      "bidirectional": false,
      "roles": [
        "wholly-owned",
        "affiliate"
      ],
      "compactKeys": {
        "from": [
          "parentCompanies"
        ],
        "to": [
          "subsidiaries"
        ]
      }
    },
    {
      "type": "LocatedAt",
      "title": "Located At",
      "description": "Metadata example: { locationType: \"headquarters\" | \"branch\" | \"warehouse\" }",
      "from": [
        "Person",
        "Company"
      ],
      "to": [
        "AssetProperty"
      ],
      "bidirectional": false,
      "roles": [
        "headquarters",
        "branch",
        "warehouse"
      ],
      "compactKeys": {
        "from": [
          "locations"
        ],
        "to": [
          "locatedEntities"
        ]
      }
    },
    {
      "type": "Signed",
      "title": "Signed",
      "description": "Metadata example: { role: \"contractor\" | \"client\" | \"witness\" | \"notary\" }",
      "from": [
        "Person",
        "Company"
      ],
      "to": [
        "Document"
      ],
      "bidirectional": false,
      "roles": [
        "contractor",
        "client",
        "witness",
        "notary"
      ],
      "compactKeys": {
        "from": [
          "documents"
        ],
        "to": [
          "signedBy"
        ]
      }
    },
    {
      "type": "HasContact",
      "title": "Has Contact",
      "description": "Metadata example: { isPrimary: true }",
      "from": [
        "Person",
        "Company",
        "Product",
        "Service",
        "Location",
        "AssetGeneric",
        "AssetVehicle",
        "AssetProperty",
        "AssetEquipment",
        "Animal",
        "BankAccount",
        "Document",
        "ContactChannel"
      ],
      "to": [
        "ContactChannel"
      ],
      "bidirectional": false,
      "roles": [],
      "compactKeys": {
        "from": [
          "contacts"
        ],
        "to": [
          "contactOwners"
        ]
      }
    }
  ],
  "capabilities": {
    "locate.byName": {
      "title": "Locate by name",
      "what": "Finds records whose name or alias matches the typed text.",
      "how": "listByType with the `name` filter over the index table; `name` is the only text filter.",
      "who": "Anyone registering or looking a record up.",
      "platform": "ready",
      "evidence": "mdmImplementation.md §5 (listByType)"
    },
    "locate.byDocument": {
      "title": "Locate by document",
      "what": "Finds the single record that holds a national document (CPF, CNPJ, SSN, EIN…).",
      "how": "findByDocument(docType, docId); loads the index and filters in JS.",
      "who": "Whoever registers, to deduplicate before creating.",
      "platform": "partial",
      "evidence": "mdmImplementation.md §5 (full scan) and §9 (UNIQUE(docType, docId) promised, absent)"
    },
    "locate.byContact": {
      "title": "Locate by contact",
      "what": "Finds the record that owns a phone, WhatsApp handle or e-mail.",
      "how": "findByContact(contactType, value); loads every ContactChannel record.",
      "who": "Whoever answers an inbound call or message.",
      "platform": "partial",
      "evidence": "mdmImplementation.md §5 (full scan, no HTTP route)"
    },
    "locate.byLogin": {
      "title": "Locate by login",
      "what": "Finds the person behind a login e-mail.",
      "how": "mdm_tag row with namespace 'login', partial unique index (namespace, tag, module).",
      "who": "The session resolver.",
      "platform": "ready",
      "evidence": "mdmImplementation.md §5, §6 (identityUsecases)",
      "appliesTo": [
        "Person"
      ]
    },
    "locate.semantic": {
      "title": "Locate by approximate name",
      "what": "Finds a record through a misspelling, a phonetic match or a partial name.",
      "how": "Needs a trigram/tsvector index or embeddings; searchVector is TEXT compared literally.",
      "who": "Reception, when the spelling is uncertain.",
      "platform": "missing",
      "evidence": "mdmImplementation.md §5 (searchVector is TEXT), §9 (tsvector promised)"
    },
    "locate.byDocumentField": {
      "title": "Locate by a field inside the document",
      "what": "Filters or sorts by something that lives only in the JSONB (birth month, city, any module field).",
      "how": "Needs the field promoted to an index column or a GIN/expression index on details.",
      "who": "Marketing, reporting.",
      "platform": "missing",
      "evidence": "mdmImplementation.md §1 (nothing inside the JSONB is indexed today)"
    },
    "register.createOrAttach": {
      "title": "Register, or attach the role to an existing record",
      "what": "Creates the record when it does not exist and, either way, marks it with the module role.",
      "how": "locate.byDocument, then create when absent, then attachRole(<module>.<Entity>) writing details[moduleId].",
      "who": "Whoever registers.",
      "platform": "ready",
      "evidence": "mdmImplementation.md §2.1 (attachRole); no dedicated route"
    },
    "register.asProspect": {
      "title": "Capture as a prospect",
      "what": "Records an interested party with no document yet (site, phone) and promotes it later.",
      "how": "prospect.create with promotionSource and ttlExpiresAt, then promoteToEntity; same mdmId.",
      "who": "Reception, the public site.",
      "platform": "ready",
      "evidence": "mdmImplementation.md §8; mdm_documents_prospects_index.subtype"
    },
    "edit.platformFields": {
      "title": "Edit the platform fields",
      "what": "Changes name, document, addresses, consent and the other fields the platform owns.",
      "how": "entity.update; identification also rewrites the index row.",
      "who": "Whoever maintains the record.",
      "platform": "partial",
      "evidence": "mdmImplementation.md §7 (almost nothing is validated on write)"
    },
    "edit.moduleNamespace": {
      "title": "Edit the module namespace",
      "what": "Changes only details[<moduleId>] — what this module knows about the record.",
      "how": "attachRole / update with the module key; another module key is refused.",
      "who": "The module itself.",
      "platform": "ready",
      "evidence": "mdmImplementation.md §2.1 (MDM_FOREIGN_NAMESPACE)"
    },
    "inactivate": {
      "title": "Inactivate and reactivate",
      "what": "Takes the record out of use without deleting it.",
      "how": "status Active → Inactive; reactivate undoes it.",
      "who": "Whoever maintains the record.",
      "platform": "partial",
      "evidence": "mdmImplementation.md §6 (inactivate does not write status history); no route"
    },
    "merge": {
      "title": "Merge duplicates",
      "what": "Joins two records of the same subject; the loser points at the winner.",
      "how": "mergeEntity sets status Merged and mergedInto.",
      "who": "An administrator.",
      "platform": "missing",
      "evidence": "mdmImplementation.md §8 (not exported by the facade nor routed)"
    },
    "delete": {
      "title": "Delete",
      "what": "Removes the record physically; refused while an active relationship exists.",
      "how": "entity.delete; MDM_DELETE_BLOCKED_BY_RELATIONSHIPS.",
      "who": "An administrator.",
      "platform": "ready",
      "evidence": "mdmImplementation.md §8"
    },
    "link": {
      "title": "Link to another record",
      "what": "Creates a versioned relationship, with a role, between two permanent records.",
      "how": "link(from, to, type, role); the engine recomputes the compact keys on both sides.",
      "who": "Whoever maintains the record.",
      "platform": "ready",
      "evidence": "mdmImplementation.md §4"
    },
    "unlink": {
      "title": "End a link",
      "what": "Closes a relationship keeping its history.",
      "how": "unlink sets status 'Inactive'; the row is never deleted.",
      "who": "Whoever maintains the record.",
      "platform": "ready",
      "evidence": "mdmImplementation.md §4"
    },
    "link.contact": {
      "title": "Add a contact channel",
      "what": "Adds a phone, WhatsApp handle or e-mail belonging to this record.",
      "how": "Create a ContactChannel record and link it with HasContact; the engine fills relationshipRefs.contacts.",
      "who": "Whoever maintains the record.",
      "platform": "ready",
      "evidence": "mdmImplementation.md §4 (contacts)"
    },
    "listLinks": {
      "title": "List the links",
      "what": "Shows the related records, with validity and role.",
      "how": "relationship.list / relatedOfMany.",
      "who": "The record screen.",
      "platform": "ready",
      "evidence": "mdmImplementation.md §4"
    },
    "attach.document": {
      "title": "Attach a file",
      "what": "Stores a photo, a scan or a signed document against the record, by category.",
      "how": "Upload to S3 or local disk, row in mdm_attachment, presigned GET.",
      "who": "Whoever maintains the record.",
      "platform": "partial",
      "evidence": "mdmImplementation.md §6 (no `module` column; no upload widget in the base frontend)"
    },
    "comment": {
      "title": "Comment",
      "what": "Leaves a note on the record; one reply level, 15-minute edit window.",
      "how": "mdm_comment anchored by (entityType, entityId, module).",
      "who": "Whoever maintains the record.",
      "platform": "ready",
      "evidence": "mdmImplementation.md §6"
    },
    "tag": {
      "title": "Tag",
      "what": "Marks the record with free labels inside the module namespace.",
      "how": "mdm_tag; unique (entityType, entityId, tag, module).",
      "who": "Whoever maintains the record.",
      "platform": "ready",
      "evidence": "mdmImplementation.md §6"
    },
    "sequence.next": {
      "title": "Next sequence number",
      "what": "Issues the next number of a counter (record number, order number).",
      "how": "mdm_number_sequence with SELECT … FOR UPDATE; key {module}.{entityType}.{scope}.",
      "who": "The module, on create.",
      "platform": "ready",
      "evidence": "mdmImplementation.md §6"
    },
    "statusHistory.read": {
      "title": "Status history",
      "what": "Shows when the record changed status and who changed it.",
      "how": "mdm_status_history.",
      "who": "The record screen.",
      "platform": "partial",
      "evidence": "mdmImplementation.md §6 (inactivate/reactivate do not write it)"
    },
    "audit": {
      "title": "Audit",
      "what": "Who changed what and when.",
      "how": "mdm_audit_log, insert-only.",
      "who": "An administrator.",
      "platform": "partial",
      "evidence": "mdmImplementation.md §6 (no reader, no route; diff only in the Dynamo copy)"
    },
    "invite.login": {
      "title": "Invite to log in",
      "what": "Gives the person a login so they can see their own data.",
      "how": "identity.invite writes the mdm_tag login row and calls collab-auth.",
      "who": "Whoever maintains the record.",
      "platform": "ready",
      "evidence": "mdmImplementation.md §6 (facade; no route)",
      "appliesTo": [
        "Person"
      ]
    },
    "export.personalData": {
      "title": "Export personal data",
      "what": "Hands the subject their own data on request (LGPD art. 18 / GDPR art. 15).",
      "how": "Would need document + links + attachments in one export.",
      "who": "An administrator.",
      "platform": "missing",
      "evidence": "ontologia_definitiva.md §8.3 (no implementation in l1/mdm)",
      "appliesTo": [
        "Person"
      ]
    },
    "anonymize": {
      "title": "Anonymize",
      "what": "Erases the personal data while keeping the record for statistics.",
      "how": "Would pseudonymize identification keeping the mdmId.",
      "who": "An administrator.",
      "platform": "missing",
      "evidence": "ontologia_definitiva.md §8.3 (no implementation in l1/mdm)",
      "appliesTo": [
        "Person"
      ]
    }
  },
  "rules": {
    "rule-person-ssn-unique-for-us": {
      "title": "One SSN per person (US)",
      "text": "Two permanent people in the US must not share the same SSN.",
      "enforcedBy": "engine",
      "platform": "partial",
      "evidence": "mdmImplementation.md §8 (dedup on promotion only) and §9 (no UNIQUE(docType, docId))"
    },
    "rule-person-privacy-consent-required-br-eu": {
      "title": "Consent required in BR and EU",
      "text": "A person resident in Brazil or the EU without a valid privacy consent is forced to Inactive.",
      "enforcedBy": "engine",
      "platform": "ready",
      "evidence": "mdmImplementation.md §7 (normalizeStatus)"
    },
    "rule-company-ein-unique-for-us": {
      "title": "One EIN per company (US)",
      "text": "Two permanent companies in the US must not share the same EIN.",
      "enforcedBy": "engine",
      "platform": "partial",
      "evidence": "mdmImplementation.md §8, §9"
    },
    "rule-company-legal-name-required": {
      "title": "Company needs a legal name",
      "text": "A company record is refused without legalName.",
      "enforcedBy": "engine",
      "platform": "ready",
      "evidence": "mdmImplementation.md §7 (validated on write)"
    },
    "rule-contact-value-unique-per-type": {
      "title": "One contact channel per type and value",
      "text": "Two contact channels must not share the same contactType and value.",
      "enforcedBy": "engine",
      "platform": "partial",
      "evidence": "mdmImplementation.md §8 (deduped on promotion) and §5 (findByContact is a full scan)"
    },
    "rule-bank-account-routing-required-for-us": {
      "title": "Routing number required (US)",
      "text": "A US bank account is refused without bankRoutingNumber.",
      "enforcedBy": "engine",
      "platform": "ready",
      "evidence": "mdmImplementation.md §7 (validated on write)"
    },
    "rule-bank-account-holder-via-relationship": {
      "title": "The account holder is a relationship",
      "text": "Who holds a bank account is the HoldsAccount link, never a field of the account.",
      "enforcedBy": "engine",
      "platform": "ready",
      "evidence": "defs/ontology.ts (BankAccountDetail.rules); mdmImplementation.md §4"
    },
    "rule-document-parties-via-relationships": {
      "title": "The parties of a document are relationships",
      "text": "Who signed a document is the Signed link, never a field of the document.",
      "enforcedBy": "engine",
      "platform": "ready",
      "evidence": "defs/ontology.ts (DocumentDetail.rules); mdmImplementation.md §4"
    },
    "rule-document-path-immutable": {
      "title": "The stored path of a document does not change",
      "text": "Once stored, the storage key of a document is never rewritten.",
      "enforcedBy": "engine",
      "platform": "ready",
      "evidence": "defs/ontology.ts (DocumentDetail.rules)"
    },
    "rule-foreign-namespace-refused": {
      "title": "A module writes only its own namespace",
      "text": "A caller carrying a moduleId may write the platform keys, `general` and its own key; any other module key is refused with MDM_FOREIGN_NAMESPACE.",
      "enforcedBy": "engine",
      "platform": "ready",
      "evidence": "mdmImplementation.md §2.1"
    },
    "rule-delete-blocked-by-relationships": {
      "title": "No deleting a linked record",
      "text": "A physical delete is refused while an active relationship exists.",
      "enforcedBy": "engine",
      "platform": "ready",
      "evidence": "mdmImplementation.md §8"
    },
    "rule-document-shape-validated": {
      "title": "The document matches the ontology",
      "text": "Addresses, consent, `general` and the module namespace should be validated on write against the schema derived from this ontology.",
      "enforcedBy": "engine",
      "platform": "missing",
      "evidence": "mdmImplementation.md §7 (everything else is Object.assign); the validation is a task of its own"
    },
    "rule-identity-never-in-namespace": {
      "title": "Identity never inside a module namespace",
      "text": "Identity, document, contact and login are platform layers; a module never redeclares them inside details[moduleId].",
      "enforcedBy": "engine",
      "platform": "partial",
      "evidence": "mdmImplementation.md §2.1 (declared in defs/platform.ts identity.neverInModule; nothing checks the content)"
    }
  },
  "statuses": [
    "Active",
    "Inactive",
    "Merged",
    "Blocked"
  ],
  "docTypes": [
    "SSN",
    "EIN",
    "Passport",
    "DriversLicense",
    "NationalId",
    "CPF",
    "CNPJ",
    "VAT",
    "Other"
  ],
  "storage": {
    "indexTable": "mdm_documents_entities_index",
    "prospectIndexTable": "mdm_documents_prospects_index",
    "documentTable": "mdm_documents",
    "documentColumn": "details",
    "reservedDocumentKeys": [
      "general",
      "<moduleId>"
    ]
  },
  "knownDivergences": [
    {
      "id": "address-value",
      "description": "Address (data) and AddressValue (interface) declare different fields."
    },
    {
      "id": "privacy-consent-value",
      "description": "PrivacyConsent (data) and PrivacyConsentValue (interface) declare different fields."
    },
    {
      "id": "contact-summary-value",
      "description": "ContactSummary (data) and ContactSummaryValue (interface) declare different fields."
    },
    {
      "id": "compact-relationship-refs-count",
      "description": "CompactRelationshipRefs has 22 keys in the data and 48 in the interface; the interface is the real one."
    },
    {
      "id": "doc-unique-missing",
      "description": "UNIQUE(docType, docId) is promised in defs/ontology.ts and absent from persistence.ts."
    },
    {
      "id": "search-vector-type",
      "description": "searchVector is documented as tsvector and created as TEXT."
    },
    {
      "id": "relationship-documents-table",
      "description": "Table mdm_relationship_documents is cited and does not exist."
    },
    {
      "id": "service-defs-case",
      "description": "JSON service definitions use PascalCase where the columns are camelCase."
    },
    {
      "id": "platform-detail-keys-copy",
      "description": "The platform key list exists twice (mdmFacade.ts and integration.ts) with different contents."
    },
    {
      "id": "emergency-contact-type",
      "description": "The relationship catalog has no EmergencyContactOf; a Family link with role `emergency` carries the meaning."
    },
    {
      "id": "contacts-written-from-input",
      "description": "details.contacts is declared derived from HasContact (the design) and is still written raw from the input by the engine, duplicating relationshipRefs.contacts."
    }
  ]
} as const satisfies MdmOntologyIndexArtifact;

export type MdmOntologyIndexType = typeof mdmOntologyIndex;

export default mdmOntologyIndex;

/** What `of` resolves against, for `tsc` and for the gate. */
export const valueTypes = { Address: mdmValueTypeAddress, GeoPoint: mdmValueTypeGeoPoint, PrivacyConsent: mdmValueTypePrivacyConsent, ContactSummary: mdmValueTypeContactSummary } as const;

/** Record types derived from the ontology — the engine reads these instead of hand-written interfaces. */
export type PersonRecord = InferRecord<typeof mdmEntityPerson.fields, typeof valueTypes>;
export type CompanyRecord = InferRecord<typeof mdmEntityCompany.fields, typeof valueTypes>;
export type ProductRecord = InferRecord<typeof mdmEntityProduct.fields, typeof valueTypes>;
export type ServiceRecord = InferRecord<typeof mdmEntityService.fields, typeof valueTypes>;
export type LocationRecord = InferRecord<typeof mdmEntityLocation.fields, typeof valueTypes>;
export type AssetGenericRecord = InferRecord<typeof mdmEntityAssetGeneric.fields, typeof valueTypes>;
export type AssetVehicleRecord = InferRecord<typeof mdmEntityAssetVehicle.fields, typeof valueTypes>;
export type AssetPropertyRecord = InferRecord<typeof mdmEntityAssetProperty.fields, typeof valueTypes>;
export type AssetEquipmentRecord = InferRecord<typeof mdmEntityAssetEquipment.fields, typeof valueTypes>;
export type AnimalRecord = InferRecord<typeof mdmEntityAnimal.fields, typeof valueTypes>;
export type BankAccountRecord = InferRecord<typeof mdmEntityBankAccount.fields, typeof valueTypes>;
export type DocumentRecord = InferRecord<typeof mdmEntityDocument.fields, typeof valueTypes>;
export type ContactChannelRecord = InferRecord<typeof mdmEntityContactChannel.fields, typeof valueTypes>;
export type AddressRecord = InferRecord<typeof mdmValueTypeAddress.fields, typeof valueTypes>;
export type GeoPointRecord = InferRecord<typeof mdmValueTypeGeoPoint.fields, typeof valueTypes>;
export type PrivacyConsentRecord = InferRecord<typeof mdmValueTypePrivacyConsent.fields, typeof valueTypes>;
export type ContactSummaryRecord = InferRecord<typeof mdmValueTypeContactSummary.fields, typeof valueTypes>;
