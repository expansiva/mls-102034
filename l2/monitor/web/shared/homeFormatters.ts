/// <mls fileReference="_102034_/l2/monitor/web/shared/homeFormatters.ts" enhancement="_blank" />
export function formatInteger(value: number | null | undefined) {
  return new Intl.NumberFormat('pt-BR').format(value ?? 0);
}

export function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return 'n/a';
  }

  return `${new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)}%`;
}

export function formatBytes(value: number | null | undefined) {
  const bytes = value ?? 0;
  if (bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const scaled = bytes / 1024 ** exponent;
  return `${scaled.toFixed(scaled >= 10 ? 0 : 1)} ${units[exponent]}`;
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return 'n/a';
  }

  return new Date(value).toLocaleString('pt-BR');
}

export function formatTime(value: string | null | undefined) {
  if (!value) {
    return 'n/a';
  }

  return new Date(value).toLocaleTimeString('pt-BR');
}

export function formatMonitorValue(value: unknown) {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return JSON.stringify(value);
}

export function formatStatusLabel(statusGroup: string) {
  switch (statusGroup) {
    case 'success':
      return 'Success';
    case 'client_error':
      return 'Client error';
    case 'server_error':
      return 'Server error';
    case 'not_found':
      return 'Not found';
    default:
      return statusGroup;
  }
}
