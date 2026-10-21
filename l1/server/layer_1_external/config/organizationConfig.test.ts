/// <mls fileReference="_102034_/l1/server/layer_1_external/config/organizationConfig.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProjectsConfig } from '/_102029_/l2/runtimeConfigTypes.js';
import { OnboardingConfigError, readOnboardingConfig } from './onboardingConfig.js';
import { resolveOrganizationBinding, type OrganizationBindingIo } from './organizationConfig.js';

const entryPath = '/Volumes/app/inicio/entry.js';

function shell(): ProjectsConfig['shellTemplates'] {
  return { spa: './spa.html', pwa: './pwa.html' };
}

function bare(defaultProjectId = '102047'): ProjectsConfig {
  return { defaultProjectId, shellTemplates: shell(), projects: {} };
}

function file(over: { orgId?: string; name?: string; projectId?: string | null } = {}) {
  return {
    schema: 1,
    generatedAt: '2026-10-17T00:00:00Z',
    org: { orgId: over.orgId ?? 'org-1', slug: 'acme', name: over.name ?? 'Acme', createdAt: '2026-10-17T00:00:00Z' },
    project: {
      projectId: over.projectId === undefined ? '102047' : over.projectId ?? '',
      domain: 'acme.test',
      appEnv: null,
      language: null,
      type: 'client',
      createdAt: '2026-10-17T00:00:00Z',
    },
  };
}

function io(over: Partial<OrganizationBindingIo> = {}): OrganizationBindingIo {
  return {
    readProjectFile: () => null,
    readProjectMode: () => 'production',
    readL5Project: () => ({ orgName: 'Oficina Lima' }),
    ...over,
  };
}

test('dois clientes da mesma org conservam a chave; orgs diferentes não', () => {
  const readers = io({
    readProjectFile: (projectId) => file({
      orgId: projectId === 102099 ? 'org-outra' : 'org-9',
      name: projectId === 102099 ? 'Outra' : 'Acme',
      projectId: String(projectId),
    }),
  });
  const first = resolveOrganizationBinding(bare('102047'), readers);
  const second = resolveOrganizationBinding(bare('102048'), readers);
  const other = resolveOrganizationBinding(bare('102099'), readers);
  assert.deepEqual(first, { key: 'org:org-9', name: 'Acme', source: 'project-file' });
  assert.equal(second?.key, first?.key);
  assert.equal(other?.key, 'org:org-outra');
  assert.notEqual(other?.key, first?.key);
});

test('renomear a org não troca a chave quando o arquivo permanece', () => {
  const renamed = resolveOrganizationBinding(bare(), io({
    readProjectFile: () => file({ orgId: 'org-9', name: 'Acme Participações' }),
  }));
  const first = resolveOrganizationBinding(bare(), io({
    readProjectFile: () => file({ orgId: 'org-9', name: 'Acme Ltda' }),
  }));
  assert.equal(renamed?.key, 'org:org-9');
  assert.equal(renamed?.key, first?.key);
  assert.equal(renamed?.name, 'Acme Participações');
});

test('sem módulo, arquivo válido resolve e projectId ou org ausentes falham', () => {
  const binding = resolveOrganizationBinding({ ...bare(), organization: { source: 'project-file' } }, io({
    readProjectFile: () => file({ orgId: 'org-9', name: 'Acme' }),
  }));
  assert.deepEqual(binding, { key: 'org:org-9', name: 'Acme', source: 'project-file' });
  assert.throws(
    () => resolveOrganizationBinding(bare(), io({ readProjectFile: () => file({ orgId: '  ' }) })),
    (error: unknown) => error instanceof OnboardingConfigError && /org\.orgId/.test(error.message),
  );
  assert.throws(
    () => resolveOrganizationBinding(bare(), io({ readProjectFile: () => file({ name: '' }) })),
    (error: unknown) => error instanceof OnboardingConfigError && /org\.name/.test(error.message),
  );
  assert.throws(
    () => resolveOrganizationBinding(bare(), io({ readProjectFile: () => file({ projectId: '102099' }) })),
    /does not match client 102047/,
  );
});

test('arquivo do sites prevalece sobre source explícito de desenvolvimento', () => {
  const binding = resolveOrganizationBinding({
    ...bare(),
    organization: { source: 'development-project' },
  }, io({
    readProjectFile: () => file({ orgId: 'org-9', name: 'Acme' }),
    readProjectMode: () => 'development',
    readL5Project: () => ({ orgName: 'Não Usar' }),
  }));
  assert.equal(binding?.source, 'project-file');
  assert.equal(binding?.key, 'org:org-9');
});

test('fallback por nome só com development-project e modo development ou presentation', () => {
  const declared = { ...bare(), organization: { source: 'development-project' as const } };
  const binding = resolveOrganizationBinding(declared, io({
    readProjectMode: () => 'presentation',
    readL5Project: () => ({ orgName: 'Oficina Lima' }),
  }));
  assert.deepEqual(binding, {
    key: 'development-org:oficina lima',
    name: 'Oficina Lima',
    source: 'development-project',
  });
  for (const mode of ['production', 'homologation'] as const) {
    assert.throws(
      () => resolveOrganizationBinding(declared, io({
        readProjectMode: () => mode,
        readL5Project: () => ({ orgName: 'Acme' }),
      })),
      new RegExp(`refused in mode '${mode}'`),
    );
  }
});

test('organization explícito prevalece sobre organizationSource legado', () => {
  const onboarding = {
    moduleId: 'inicio',
    entryPath,
    personType: 'inicio.pessoa',
    companyType: 'inicio.empresa',
    organizationSource: 'development-project' as const,
  };
  assert.throws(
    () => resolveOrganizationBinding({
      ...bare(),
      organization: { source: 'project-file' },
      onboarding,
    }, io({
      readProjectMode: () => 'development',
      readL5Project: () => ({ orgName: 'Acme' }),
    })),
    /project file is absent/,
  );
  const binding = resolveOrganizationBinding({
    ...bare(),
    organization: { source: 'development-project' },
    onboarding: { ...onboarding, organizationSource: 'project-file' as const },
  }, io({
    readProjectMode: () => 'development',
    readL5Project: () => ({ orgName: 'Oficina Lima' }),
  }));
  assert.equal(binding?.key, 'development-org:oficina lima');
  assert.equal(binding?.source, 'development-project');
});

test('campo explícito não lê o módulo; config errada não cai no null', () => {
  const binding = resolveOrganizationBinding({
    ...bare(),
    organization: {},
    onboarding: { moduleId: '' } as ProjectsConfig['onboarding'],
  }, io({ readProjectFile: () => file({ orgId: 'org-9', name: 'Acme' }) }));
  assert.equal(binding?.key, 'org:org-9');
  assert.throws(
    () => resolveOrganizationBinding({ ...bare(), organization: { source: 'local' as 'project-file' } }, io()),
    /not supported/,
  );
  assert.throws(
    () => resolveOrganizationBinding({ ...bare(), organization: { source: 'project-file' } }, io()),
    /project file is absent/,
  );
});

test('null só no preview legado sem organization, sem onboarding e sem arquivo', () => {
  assert.equal(resolveOrganizationBinding(bare(), io()), null);
  assert.equal(readOnboardingConfig(bare()), null);
  const fromFile = resolveOrganizationBinding(bare(), io({
    readProjectFile: () => file({ orgId: 'org-9', name: 'Acme' }),
  }));
  assert.equal(fromFile?.key, 'org:org-9');
  const withModule = resolveOrganizationBinding({
    ...bare(),
    onboarding: {
      moduleId: 'inicio',
      entryPath,
      personType: 'inicio.pessoa',
      companyType: 'inicio.empresa',
    },
  }, io({ readProjectFile: () => file({ orgId: 'org-9', name: 'Acme' }) }));
  assert.deepEqual(fromFile, withModule);
});
