/// <mls fileReference="_102034_/l2/audit/web/shared/formatters.ts" enhancement="_blank" />
export function formatInteger(value: number | null | undefined) {
  return new Intl.NumberFormat('pt-BR').format(value ?? 0);
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return 'n/a';
  }
  return new Date(value).toLocaleString('pt-BR');
}

export function formatJson(value: unknown) {
  if (value === null || value === undefined) {
    return 'null';
  }
  return JSON.stringify(value, null, 2);
}
