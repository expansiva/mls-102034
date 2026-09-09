# MDM (`mls-102034/l1/mdm`)

Shared master-data engine for every client project on the VM. Tables are **not**
prefixed by project or module — treat them as organization-wide state.

## Three layers in `details`

| layer | where | who owns it |
|---|---|---|
| identification | index columns (`mdmId`, `subtype`, `name`, `status`, `docType`, `docId`, `countryCode`, `tags`) | platform |
| base | typed keys inside the document jsonb (`contacts`, `addresses`, `birthDate`, …) | platform |
| `general` | document key `general` (`MdmGeneralNamespace`) | organization (schema in the solution registry, l4) |
| module | document key `<moduleId>` | that module |

`general` is reserved: the engine keeps the key and does not filter it. Field
schema is not enforced here.

## Keys open, content closed

`ctx.mdm` reads (`get`, `getMany`, `hydrateMany`, `listByType`) return
identification + base + `general` + the caller’s `<ctx.moduleId>`, plus
`namespaces: string[]` naming every **other** module key (no content; the caller’s own key is the object, not a name in that list).

- No `moduleId`, or `moduleId === 'organization'`: the platform / super module
  — full document, still with `namespaces`.
- Writes (`create` / `update`) accept platform keys + `general` +
  `<ctx.moduleId>` only. Any other module key → `AppError('MDM_FOREIGN_NAMESPACE', 400)`.
- `namespaces` on a read result is computed; it is stripped on write.

Caller module comes from the BFF routine (`execBff` stamps `ctx.moduleId`).

## Create-or-attach

```
ctx.mdm.entity.findByDocument(docType, docId)
ctx.mdm.entity.findByContact(contactType, value)
ctx.mdm.entity.attachRole(mdmId, role, namespace?)
```

`attachRole` adds tag `<moduleId>.<role>` without duplicating and, when given,
writes the caller namespace.

## Organization on `ctx`

`ctx.organization.countryCode` is the installation/org country (never derived
from UI language). Source today: `ORGANIZATION_COUNTRY_CODE` / `COUNTRY_CODE`
in env, default `US` (MDM ontology). Currency and timezone are optional.
