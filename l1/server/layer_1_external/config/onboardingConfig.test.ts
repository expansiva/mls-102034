/// <mls fileReference="_102034_/l1/server/layer_1_external/config/onboardingConfig.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProjectsConfig } from '/_102029_/l2/runtimeConfigTypes.js';
import {
  OnboardingConfigError,
  readOnboardingConfig,
  resolveOrganizationBinding,
  type OrganizationBindingIo,
} from './onboardingConfig.js';

const entryPath = '/Volumes/app/inicio/entry.js';

function config(over: Partial<ProjectsConfig> = {}): ProjectsConfig {
  return {
    defaultProjectId: '102047',
    shellTemplates: { spa: './spa.html', pwa: './pwa.html' },
    projects: {},
    onboarding: {
      moduleId: 'inicio',
      entryPath,
      personType: 'inicio.pessoa',
      companyType: 'inicio.empresa',
    },
    ...over,
  };
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

test('config ausente deixa o onboarding desligado', () => {
  const bare = config();
  delete bare.onboarding;
  assert.equal(readOnboardingConfig(bare), null);
  assert.equal(resolveOrganizationBinding(bare, io()), null);
  assert.equal(readOnboardingConfig(null), null);
});

test('fonte sites usa orgId do cliente e conserva o id quando o nome muda', () => {
  const readers = io({ readProjectFile: () => file({ orgId: 'org-9', name: 'Acme Ltda' }) });
  const first = resolveOrganizationBinding(config(), readers);
  const renamed = resolveOrganizationBinding(config(), io({
    readProjectFile: () => file({ orgId: 'org-9', name: 'Acme Participações' }),
  }));
  assert.deepEqual(first, { key: 'org:org-9', name: 'Acme Ltda', source: 'project-file' });
  assert.equal(renamed?.key, first?.key);
  assert.equal(renamed?.name, 'Acme Participações');
});

test('arquivo de sites vence o fallback declarado', () => {
  const binding = resolveOrganizationBinding(config({
    onboarding: {
      moduleId: 'inicio',
      entryPath,
      personType: 'inicio.pessoa',
      companyType: 'inicio.empresa',
      organizationSource: 'development-project',
    },
  }), io({
    readProjectFile: () => file({ orgId: 'org-9', name: 'Acme' }),
    readProjectMode: () => 'presentation',
  }));
  assert.equal(binding?.source, 'project-file');
  assert.equal(binding?.key, 'org:org-9');
});

test('id ausente, projectId incompatível e arquivo ausente falham sem inventar chave', () => {
  assert.throws(
    () => resolveOrganizationBinding(config(), io({ readProjectFile: () => file({ orgId: '  ' }) })),
    (error: unknown) => error instanceof OnboardingConfigError && /org\.orgId/.test(error.message),
  );
  assert.throws(
    () => resolveOrganizationBinding(config(), io({ readProjectFile: () => file({ projectId: '102099' }) })),
    /does not match client 102047/,
  );
  assert.throws(
    () => resolveOrganizationBinding(config(), io({ readProjectFile: () => null })),
    /project file is absent/,
  );
});

test('fallback de apresentação usa o nome declarado e outro nome troca a identidade', () => {
  const declared = config({
    onboarding: {
      moduleId: 'inicio',
      entryPath,
      personType: 'cadastro.pessoa',
      companyType: 'cadastro.empresa',
      organizationSource: 'development-project',
    },
  });
  const binding = resolveOrganizationBinding(declared, io({
    readProjectMode: () => 'presentation',
    readL5Project: () => ({ orgName: '  Oficina Lima  ' }),
  }));
  assert.deepEqual(binding, {
    key: 'development-org:oficina lima',
    name: '  Oficina Lima  ',
    source: 'development-project',
  });
  const changed = resolveOrganizationBinding(declared, io({
    readProjectMode: () => 'development',
    readL5Project: () => ({ orgName: 'Outra Oficina' }),
  }));
  assert.equal(changed?.key, 'development-org:outra oficina');
  assert.notEqual(changed?.key, binding?.key);
});

test('produção e homologação recusam fallback por nome', () => {
  const declared = config({
    onboarding: {
      moduleId: 'inicio',
      entryPath,
      personType: 'inicio.pessoa',
      companyType: 'inicio.empresa',
      organizationSource: 'development-project',
    },
  });
  for (const mode of ['production', 'homologation'] as const) {
    assert.throws(
      () => resolveOrganizationBinding(declared, io({ readProjectMode: () => mode, readL5Project: () => ({ orgName: 'Acme' }) })),
      new RegExp(`refused in mode '${mode}'`),
    );
  }
});

test('placeholder, nome vazio e fonte não suportada não geram id', () => {
  const declared = config({
    onboarding: {
      moduleId: 'inicio',
      entryPath,
      personType: 'inicio.pessoa',
      companyType: 'inicio.empresa',
      organizationSource: 'development-project',
    },
  });
  const readers = io({ readProjectMode: () => 'development' });
  assert.throws(
    () => resolveOrganizationBinding(declared, { ...readers, readL5Project: () => ({ orgName: '[org]' }) }),
    /placeholder/,
  );
  assert.throws(
    () => resolveOrganizationBinding(declared, { ...readers, readL5Project: () => ({ orgName: '   ' }) }),
    /orgName/,
  );
  assert.throws(
    () => readOnboardingConfig({
      onboarding: {
        moduleId: 'inicio',
        entryPath,
        personType: 'inicio.pessoa',
        companyType: 'inicio.empresa',
        organizationSource: 'local' as 'project-file',
      },
    }),
    /not supported/,
  );
});

test('bloco incompleto, tags do módulo e entryPath rejeitam origem externa', () => {
  assert.throws(() => readOnboardingConfig({
    onboarding: { moduleId: 'inicio', entryPath, personType: '  ', companyType: 'inicio.empresa' },
  }), /personType/);
  const parsed = readOnboardingConfig(config());
  assert.equal(parsed?.personType, 'inicio.pessoa');
  assert.equal(parsed?.companyType, 'inicio.empresa');
  assert.equal(parsed?.moduleId, 'inicio');
  for (const bad of ['https://evil.example/entry.js', '//cdn.example/entry.js', 'inicio/entry.js', '/tmp/app//entry.js']) {
    assert.throws(
      () => readOnboardingConfig({
        onboarding: { moduleId: 'inicio', entryPath: bad, personType: 'inicio.pessoa', companyType: 'inicio.empresa' },
      }),
      OnboardingConfigError,
    );
  }
});
