/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/core/microdiff.ts" enhancement="_blank" />
import type { MdmAuditDiffEntry } from '/_102034_/l1/mdm/module.js';

const richTypes: Record<string, true> = {
  Date: true,
  RegExp: true,
  String: true,
  Number: true,
};

export function microdiff(
  obj: Record<string, unknown> | unknown[],
  newObj: Record<string, unknown> | unknown[],
  stack: Record<string, unknown>[] = [],
): MdmAuditDiffEntry[] {
  const diffs: MdmAuditDiffEntry[] = [];
  const isObjArray = Array.isArray(obj);

  for (const key in obj) {
    const objKey = obj[key as keyof typeof obj];
    const path = isObjArray ? Number(key) : key;

    if (!(key in newObj)) {
      diffs.push({
        type: 'REMOVE',
        path: [path],
        oldValue: objKey,
      });
      continue;
    }

    const newObjKey = newObj[key as keyof typeof newObj];
    const areCompatibleObjects =
      typeof objKey === 'object' &&
      typeof newObjKey === 'object' &&
      Array.isArray(objKey) === Array.isArray(newObjKey);

    if (
      objKey &&
      newObjKey &&
      areCompatibleObjects &&
      !richTypes[Object.getPrototypeOf(objKey)?.constructor?.name ?? ''] &&
      !stack.includes(objKey as Record<string, unknown>)
    ) {
      const nestedDiffs = microdiff(
        objKey as Record<string, unknown> | unknown[],
        newObjKey as Record<string, unknown> | unknown[],
        stack.concat([objKey as Record<string, unknown>]),
      ).map((difference) => ({
        ...difference,
        path: [path, ...difference.path],
      }));
      diffs.push(...nestedDiffs);
      continue;
    }

    const isEquivalentNaN =
      Number.isNaN(objKey) && Number.isNaN(newObjKey);
    const isEquivalentRichType =
      areCompatibleObjects &&
      (Number.isNaN(objKey)
        ? String(objKey) === String(newObjKey)
        : Number(objKey) === Number(newObjKey));

    if (objKey !== newObjKey && !isEquivalentNaN && !isEquivalentRichType) {
      diffs.push({
        type: 'CHANGE',
        path: [path],
        oldValue: objKey,
        value: newObjKey,
      });
    }
  }

  const isNewObjArray = Array.isArray(newObj);
  for (const key in newObj) {
    if (!(key in obj)) {
      diffs.push({
        type: 'CREATE',
        path: [isNewObjArray ? Number(key) : key],
        value: newObj[key as keyof typeof newObj],
      });
    }
  }

  return diffs;
}
