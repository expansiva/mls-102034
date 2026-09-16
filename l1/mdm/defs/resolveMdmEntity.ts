/// <mls fileReference="_102034_/l1/mdm/defs/resolveMdmEntity.ts" enhancement="_blank" />

// Compatibility seam for backend/tests. The browser-safe implementation lives at l2,
// because hosted Studio applications intentionally do not expose l1 modules.
export * from '/_102034_/l2/mdm/resolveMdmEntity.js';
