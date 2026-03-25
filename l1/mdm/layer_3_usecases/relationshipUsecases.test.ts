/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/relationshipUsecases.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import {
  createEntity,
  createProspect,
  getEntity,
  promoteProspect,
} from '/_102034_/l1/mdm/layer_3_usecases/recordUsecases.js';
import {
  createRelationship,
  listRelationships,
  updateRelationship,
} from '/_102034_/l1/mdm/layer_3_usecases/relationshipUsecases.js';

test('createRelationship stores compact employee refs in company and person details', async () => {
  const ctx = createRequestContext();

  const company = await createEntity(ctx, {
    detail: {
      subtype: 'Company',
      name: 'Northwind',
      legalName: 'Northwind LLC',
      status: 'Active',
    },
  });
  const employeeA = await createEntity(ctx, {
    detail: {
      subtype: 'Person',
      name: 'Alice Employee',
      status: 'Active',
      privacyConsent: {
        consentedAt: '2026-03-18T10:00:00.000Z',
        consentVersion: 'v1',
        channel: 'web',
      },
    },
  });
  const employeeB = await createEntity(ctx, {
    detail: {
      subtype: 'Person',
      name: 'Bob Employee',
      status: 'Active',
      privacyConsent: {
        consentedAt: '2026-03-18T10:00:00.000Z',
        consentVersion: 'v1',
        channel: 'web',
      },
    },
  });

  await createRelationship(ctx, {
    fromId: company.mdmId,
    toId: employeeA.mdmId,
    type: 'Employs',
    validFrom: '2026-03-18',
  });
  await createRelationship(ctx, {
    fromId: company.mdmId,
    toId: employeeB.mdmId,
    type: 'Employs',
    validFrom: '2026-03-18',
  });

  const companyDetails = (await getEntity(ctx, company.mdmId)).details;
  const employeeDetails = (await getEntity(ctx, employeeA.mdmId)).details;

  assert.deepEqual(companyDetails.relationshipRefs.employees, [employeeA.mdmId, employeeB.mdmId]);
  assert.deepEqual(employeeDetails.relationshipRefs.employers, [company.mdmId]);
});

test('createRelationship stores compact pet refs in person details', async () => {
  const ctx = createRequestContext();

  const guardian = await createEntity(ctx, {
    detail: {
      subtype: 'Person',
      name: 'Pet Owner',
      status: 'Active',
      privacyConsent: {
        consentedAt: '2026-03-18T10:00:00.000Z',
        consentVersion: 'v1',
        channel: 'web',
      },
    },
  });
  const pet = await createEntity(ctx, {
    detail: {
      subtype: 'Animal',
      name: 'Milo',
      status: 'Active',
    },
  });

  await createRelationship(ctx, {
    fromId: guardian.mdmId,
    toId: pet.mdmId,
    type: 'GuardianOf',
    validFrom: '2026-03-18',
  });

  const guardianDetails = (await getEntity(ctx, guardian.mdmId)).details;
  const petDetails = (await getEntity(ctx, pet.mdmId)).details;

  assert.deepEqual(guardianDetails.relationshipRefs.pets, [pet.mdmId]);
  assert.deepEqual(petDetails.relationshipRefs.guardians, [guardian.mdmId]);
});

test('updateRelationship removes compact refs when relationship becomes inactive', async () => {
  const ctx = createRequestContext();

  const company = await createEntity(ctx, {
    detail: {
      subtype: 'Company',
      name: 'Acme',
      legalName: 'Acme Inc',
      status: 'Active',
    },
  });
  const employee = await createEntity(ctx, {
    detail: {
      subtype: 'Person',
      name: 'Charlie',
      status: 'Active',
      privacyConsent: {
        consentedAt: '2026-03-18T10:00:00.000Z',
        consentVersion: 'v1',
        channel: 'web',
      },
    },
  });

  const created = await createRelationship(ctx, {
    fromId: company.mdmId,
    toId: employee.mdmId,
    type: 'Employs',
    validFrom: '2026-03-18',
  });

  await updateRelationship(ctx, {
    id: created.relationship.id,
    patch: {
      status: 'Inactive',
    },
  });

  const companyDetails = (await getEntity(ctx, company.mdmId)).details;
  const employeeDetails = (await getEntity(ctx, employee.mdmId)).details;

  assert.equal(companyDetails.relationshipRefs.employees, undefined);
  assert.equal(employeeDetails.relationshipRefs.employers, undefined);
});

test('listRelationships filters by entity using batch lookup path', async () => {
  const ctx = createRequestContext();

  const company = await createEntity(ctx, {
    detail: {
      subtype: 'Company',
      name: 'Rel List',
      legalName: 'Rel List LLC',
      status: 'Active',
    },
  });
  const employee = await createEntity(ctx, {
    detail: {
      subtype: 'Person',
      name: 'Dana',
      status: 'Active',
      privacyConsent: {
        consentedAt: '2026-03-18T10:00:00.000Z',
        consentVersion: 'v1',
        channel: 'web',
      },
    },
  });

  const created = await createRelationship(ctx, {
    fromId: company.mdmId,
    toId: employee.mdmId,
    type: 'Employs',
    validFrom: '2026-03-18',
  });

  const relationships = await listRelationships(ctx, {
    entityId: company.mdmId,
    scope: 'entity',
  });

  assert.equal(relationships.length, 1);
  assert.equal(relationships[0]?.id, created.relationship.id);
});

test('promoteProspect migrates relationship and refreshes compact refs on entity details', async () => {
  const ctx = createRequestContext();

  const company = await createEntity(ctx, {
    detail: {
      subtype: 'Company',
      name: 'Prospect Employer',
      legalName: 'Prospect Employer LLC',
      status: 'Active',
    },
  });
  const prospectEmployee = await createProspect(ctx, {
    detail: {
      subtype: 'Person',
      name: 'Future Employee',
      status: 'New',
      promotionSource: 'crm',
      privacyConsent: {
        consentedAt: '2026-03-18T10:00:00.000Z',
        consentVersion: 'v1',
        channel: 'web',
      },
    },
  });

  await createRelationship(ctx, {
    fromId: company.mdmId,
    toId: prospectEmployee.mdmId,
    type: 'Employs',
    validFrom: '2026-03-18',
  });
  await promoteProspect(ctx, { mdmId: prospectEmployee.mdmId });

  const companyDetails = (await getEntity(ctx, company.mdmId)).details;
  const employeeDetails = (await getEntity(ctx, prospectEmployee.mdmId)).details;

  assert.deepEqual(companyDetails.relationshipRefs.employees, [prospectEmployee.mdmId]);
  assert.deepEqual(employeeDetails.relationshipRefs.employers, [company.mdmId]);
});

test('product, service and location relationships create compact refs for catalog, stock and allocation', async () => {
  const ctx = createRequestContext();

  const supplier = await createEntity(ctx, {
    detail: {
      subtype: 'Company',
      name: 'Chair Supplier',
      legalName: 'Chair Supplier LLC',
      status: 'Active',
    },
  });
  const product = await createEntity(ctx, {
    detail: {
      subtype: 'Product',
      name: 'Chair',
      status: 'Active',
      sku: 'CHAIR-001',
      productType: 'Physical',
      isInventoried: true,
    },
  });
  const room = await createEntity(ctx, {
    detail: {
      subtype: 'Location',
      name: 'Room 2',
      status: 'Active',
      locationType: 'Room',
      locationCode: 'ROOM-2',
    },
  });
  const course = await createEntity(ctx, {
    detail: {
      subtype: 'Service',
      name: 'Engineering 1',
      status: 'Active',
      serviceType: 'Course',
      durationMinutes: 180,
      deliveryMode: 'Onsite',
    },
  });
  const teacher = await createEntity(ctx, {
    detail: {
      subtype: 'Person',
      name: 'Professor Joao',
      status: 'Active',
      privacyConsent: {
        consentedAt: '2026-03-18T10:00:00.000Z',
        consentVersion: 'v1',
        channel: 'web',
      },
    },
  });

  await createRelationship(ctx, {
    fromId: supplier.mdmId,
    toId: product.mdmId,
    type: 'OffersProduct',
    validFrom: '2026-03-18',
  });
  await createRelationship(ctx, {
    fromId: product.mdmId,
    toId: room.mdmId,
    type: 'StocksAt',
    validFrom: '2026-03-18',
    metadata: {
      quantity: 20,
      unit: 'unit',
      inventorySlot: 'sala1',
    },
  });
  await createRelationship(ctx, {
    fromId: teacher.mdmId,
    toId: course.mdmId,
    type: 'Teaches',
    validFrom: '2026-03-18',
  });
  await createRelationship(ctx, {
    fromId: course.mdmId,
    toId: room.mdmId,
    type: 'HappensAt',
    validFrom: '2026-03-18',
  });

  const supplierDetails = (await getEntity(ctx, supplier.mdmId)).details;
  const productDetails = (await getEntity(ctx, product.mdmId)).details;
  const roomDetails = (await getEntity(ctx, room.mdmId)).details;
  const courseDetails = (await getEntity(ctx, course.mdmId)).details;
  const teacherDetails = (await getEntity(ctx, teacher.mdmId)).details;

  assert.deepEqual(supplierDetails.relationshipRefs.offeredProducts, [product.mdmId]);
  assert.deepEqual(productDetails.relationshipRefs.productSuppliers, [supplier.mdmId]);
  assert.deepEqual(productDetails.relationshipRefs.stockLocations, [room.mdmId]);
  assert.deepEqual(roomDetails.relationshipRefs.stockedItems, [product.mdmId]);
  assert.deepEqual(teacherDetails.relationshipRefs.taughtServices, [course.mdmId]);
  assert.deepEqual(courseDetails.relationshipRefs.instructors, [teacher.mdmId]);
  assert.deepEqual(courseDetails.relationshipRefs.serviceLocations, [room.mdmId]);
  assert.deepEqual(roomDetails.relationshipRefs.scheduledServices, [course.mdmId]);
});

test('organizational and cohort relationships create compact refs for franchise, group, unit and attendance', async () => {
  const ctx = createRequestContext();

  const matrix = await createEntity(ctx, {
    detail: {
      subtype: 'Company',
      name: 'Matrix Corp',
      legalName: 'Matrix Corp SA',
      status: 'Active',
      companyKind: 'LegalEntity',
    },
  });
  const franchise = await createEntity(ctx, {
    detail: {
      subtype: 'Company',
      name: 'Franchise Rio',
      legalName: 'Franchise Rio LTDA',
      status: 'Active',
      companyKind: 'Franchise',
      parentCompanyId: matrix.mdmId,
    },
  });
  const group = await createEntity(ctx, {
    detail: {
      subtype: 'Company',
      name: 'Engineering Group',
      legalName: 'Engineering Group',
      status: 'Active',
      companyKind: 'Group',
    },
  });
  const team = await createEntity(ctx, {
    detail: {
      subtype: 'Company',
      name: 'Team Alpha',
      legalName: 'Team Alpha',
      status: 'Active',
      companyKind: 'Team',
    },
  });
  const course = await createEntity(ctx, {
    detail: {
      subtype: 'Service',
      name: 'Engineering 1',
      status: 'Active',
      serviceKind: 'Course',
    },
  });
  const cohort = await createEntity(ctx, {
    detail: {
      subtype: 'Service',
      name: 'Engineering 1 - 2026',
      status: 'Active',
      serviceKind: 'Cohort',
      parentServiceId: course.mdmId,
    },
  });
  const teacher = await createEntity(ctx, {
    detail: {
      subtype: 'Person',
      name: 'Professor Joao',
      status: 'Active',
      privacyConsent: {
        consentedAt: '2026-03-18T10:00:00.000Z',
        consentVersion: 'v1',
        channel: 'web',
      },
    },
  });
  const student = await createEntity(ctx, {
    detail: {
      subtype: 'Person',
      name: 'Student One',
      status: 'Active',
      privacyConsent: {
        consentedAt: '2026-03-18T10:00:00.000Z',
        consentVersion: 'v1',
        channel: 'web',
      },
    },
  });

  await createRelationship(ctx, {
    fromId: franchise.mdmId,
    toId: matrix.mdmId,
    type: 'FranchiseOf',
    validFrom: '2026-03-18',
  });
  await createRelationship(ctx, {
    fromId: team.mdmId,
    toId: group.mdmId,
    type: 'BelongsToGroup',
    validFrom: '2026-03-18',
  });
  await createRelationship(ctx, {
    fromId: team.mdmId,
    toId: franchise.mdmId,
    type: 'PartOfUnit',
    validFrom: '2026-03-18',
  });
  await createRelationship(ctx, {
    fromId: teacher.mdmId,
    toId: cohort.mdmId,
    type: 'AssignedTo',
    validFrom: '2026-03-18',
  });
  await createRelationship(ctx, {
    fromId: student.mdmId,
    toId: cohort.mdmId,
    type: 'Attends',
    validFrom: '2026-03-18',
  });

  const matrixDetails = (await getEntity(ctx, matrix.mdmId)).details;
  const franchiseDetails = (await getEntity(ctx, franchise.mdmId)).details;
  const groupDetails = (await getEntity(ctx, group.mdmId)).details;
  const teamDetails = (await getEntity(ctx, team.mdmId)).details;
  const cohortDetails = (await getEntity(ctx, cohort.mdmId)).details;
  const teacherDetails = (await getEntity(ctx, teacher.mdmId)).details;
  const studentDetails = (await getEntity(ctx, student.mdmId)).details;

  assert.deepEqual(matrixDetails.relationshipRefs.franchisees, [franchise.mdmId]);
  assert.deepEqual(franchiseDetails.relationshipRefs.franchisors, [matrix.mdmId]);
  assert.deepEqual(groupDetails.relationshipRefs.groupMembers, [team.mdmId]);
  assert.deepEqual(teamDetails.relationshipRefs.groupParents, [group.mdmId]);
  assert.deepEqual(franchiseDetails.relationshipRefs.unitChildren, [team.mdmId]);
  assert.deepEqual(teamDetails.relationshipRefs.unitParents, [franchise.mdmId]);
  assert.deepEqual(teacherDetails.relationshipRefs.assignments, [cohort.mdmId]);
  assert.deepEqual(cohortDetails.relationshipRefs.assignees, [teacher.mdmId]);
  assert.deepEqual(studentDetails.relationshipRefs.attendedServices, [cohort.mdmId]);
  assert.deepEqual(cohortDetails.relationshipRefs.attendees, [student.mdmId]);
});
