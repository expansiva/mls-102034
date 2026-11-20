/// <mls fileReference="_102034_/l2/monitor/web/routes/externalSystemsText.ts" enhancement="_blank" />

/** User-facing strings for the external systems monitor page. Default language is `en`. */
export interface ExternalSystemsText {
  title: string;
  refresh: string;
  loading: string;
  loadFailed: string;
  forbidden: string;
  pickModule: string;
  noModules: string;
  noSystems: string;
  systemsCount: string;
  hosts: string;
  hooks: string;
  copy: string;
  copied: string;
  copyFailed: string;
  settings: string;
  filled: string;
  missing: string;
  secret: string;
  save: string;
  saved: string;
  saveFailed: string;
  newValue: string;
  calls: string;
  when: string;
  direction: string;
  operation: string;
  server: string;
  outcome: string;
  code: string;
  duration: string;
  noCalls: string;
  writeFailures: string;
  out: string;
  in: string;
}

const en: ExternalSystemsText = {
  title: 'External systems',
  refresh: 'Refresh',
  loading: 'Loading external systems...',
  loadFailed: 'Could not load external systems.',
  forbidden: 'App admin, or admin of this module, is required.',
  pickModule: 'Choose a module',
  noModules: 'No module declares an external system.',
  noSystems: 'This module declares no external system.',
  systemsCount: '{n} system(s)',
  hosts: 'Allowed hosts',
  hooks: 'Serve hooks',
  copy: 'Copy',
  copied: 'Hook copied.',
  copyFailed: 'Copy failed.',
  settings: 'Settings',
  filled: 'filled',
  missing: 'missing',
  secret: 'secret',
  save: 'Save',
  saved: 'Saved.',
  saveFailed: 'Could not save the setting.',
  newValue: 'New value',
  calls: 'Recent calls',
  when: 'When',
  direction: 'Direction',
  operation: 'Operation',
  server: 'Server',
  outcome: 'Outcome',
  code: 'Code',
  duration: 'Duration',
  noCalls: 'No calls recorded.',
  writeFailures: 'Record write failures',
  out: 'out',
  in: 'in',
};

const pt: ExternalSystemsText = {
  title: 'Sistemas externos',
  refresh: 'Atualizar',
  loading: 'Carregando sistemas externos...',
  loadFailed: 'Não foi possível carregar os sistemas externos.',
  forbidden: 'É preciso ser administrador do app ou deste módulo.',
  pickModule: 'Escolha um módulo',
  noModules: 'Nenhum módulo declara um sistema externo.',
  noSystems: 'Este módulo não declara sistema externo.',
  systemsCount: '{n} sistema(s)',
  hosts: 'Hosts permitidos',
  hooks: 'Hooks de entrada',
  copy: 'Copiar',
  copied: 'Hook copiado.',
  copyFailed: 'Falha ao copiar.',
  settings: 'Configurações',
  filled: 'preenchido',
  missing: 'ausente',
  secret: 'segredo',
  save: 'Salvar',
  saved: 'Salvo.',
  saveFailed: 'Não foi possível salvar a configuração.',
  newValue: 'Novo valor',
  calls: 'Chamadas recentes',
  when: 'Quando',
  direction: 'Direção',
  operation: 'Operação',
  server: 'Servidor',
  outcome: 'Resultado',
  code: 'Código',
  duration: 'Duração',
  noCalls: 'Nenhuma chamada registrada.',
  writeFailures: 'Falhas ao gravar o registro',
  out: 'saída',
  in: 'entrada',
};

const catalog: Record<string, ExternalSystemsText> = { en, pt };

export function externalSystemsCatalog(): Record<string, ExternalSystemsText> {
  return catalog;
}

export function externalSystemsTextFor(lang: string): ExternalSystemsText {
  const key = lang.toLowerCase().slice(0, 2);
  return catalog[key] ?? en;
}

/** `getMessageKey` lives in the page: this module stays free of the browser runtime so Node can test the catalog. */
export function externalSystemsPageText(languageKey: string): ExternalSystemsText {
  return catalog[languageKey] ?? en;
}

/** Server text stays in the log. The screen speaks from the error code. */
export function externalSystemsErrorText(code: string | undefined, text: ExternalSystemsText, fallback: string): string {
  if (code === 'FORBIDDEN') return text.forbidden;
  return fallback;
}

export function externalSystemsCount(text: ExternalSystemsText, count: number): string {
  return text.systemsCount.replace('{n}', String(count));
}
