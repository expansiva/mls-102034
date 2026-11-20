/// <mls fileReference="_102034_/l2/monitor/web/routes/moduleEventsText.ts" enhancement="_blank" />

/** User-facing strings for the module events monitor page. Default language is `en`. */
export interface ModuleEventsText {
  title: string;
  refresh: string;
  loading: string;
  loadFailed: string;
  forbidden: string;
  empty: string;
  eventsCount: string;
  events: string;
  event: string;
  subscribers: string;
  published24h: string;
  published7d: string;
  delivered: string;
  pending: string;
  failed: string;
  failures: string;
  consumer: string;
  attempts: string;
  reason: string;
  when: string;
  noFailures: string;
  filtered: string;
}

const en: ModuleEventsText = {
  title: 'Module events',
  refresh: 'Refresh',
  loading: 'Loading module events...',
  loadFailed: 'Could not load module events.',
  forbidden: 'App admin, or admin of this module, is required.',
  empty: 'No module events.',
  eventsCount: '{n} event(s).',
  events: 'Events',
  event: 'Event',
  subscribers: 'Subscribers',
  published24h: 'Published (24h)',
  published7d: 'Published (7 days)',
  delivered: 'Delivered',
  pending: 'Pending',
  failed: 'Failed',
  failures: 'Failures',
  consumer: 'Subscriber',
  attempts: 'Attempts',
  reason: 'Reason',
  when: 'When',
  noFailures: 'No failures.',
  filtered: 'Filtered by module',
};

const pt: ModuleEventsText = {
  title: 'Eventos entre módulos',
  refresh: 'Atualizar',
  loading: 'Carregando eventos entre módulos...',
  loadFailed: 'Não foi possível carregar os eventos entre módulos.',
  forbidden: 'É preciso ser administrador do app ou deste módulo.',
  empty: 'Nenhum evento entre módulos.',
  eventsCount: '{n} evento(s).',
  events: 'Eventos',
  event: 'Evento',
  subscribers: 'Assinantes',
  published24h: 'Publicados (24 h)',
  published7d: 'Publicados (7 dias)',
  delivered: 'Entregues',
  pending: 'Pendentes',
  failed: 'Falhas',
  failures: 'Falhas',
  consumer: 'Assinante',
  attempts: 'Tentativas',
  reason: 'Motivo',
  when: 'Quando',
  noFailures: 'Nenhuma falha.',
  filtered: 'Filtrado pelo módulo',
};

const catalog: Record<string, ModuleEventsText> = { en, pt };

export function moduleEventsCatalog(): Record<string, ModuleEventsText> {
  return catalog;
}

export function moduleEventsTextFor(lang: string): ModuleEventsText {
  const key = lang.toLowerCase().slice(0, 2);
  return catalog[key] ?? en;
}

/** `getMessageKey` lives in the page: this module stays free of the browser runtime so Node can test the catalog. */
export function moduleEventsPageText(languageKey: string): ModuleEventsText {
  return catalog[languageKey] ?? en;
}

/** Server text stays in the log. The screen speaks from the error code. */
export function moduleEventsErrorText(code: string | undefined, text: ModuleEventsText, fallback: string): string {
  if (code === 'FORBIDDEN') return text.forbidden;
  return fallback;
}

export function moduleEventsCount(text: ModuleEventsText, count: number): string {
  return text.eventsCount.replace('{n}', String(count));
}
