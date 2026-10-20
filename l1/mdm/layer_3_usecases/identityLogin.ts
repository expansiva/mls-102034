/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/identityLogin.ts" enhancement="_blank" />
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

export function normalizeLoginEmail(email: string): string {
  return email.trim().toLowerCase();
}

function loginEmailRejection(normalized: string): 'required' | 'too-long' | null {
  if (!normalized || !normalized.includes('@') || /\s/u.test(normalized)) return 'required';
  if (normalized.length > 254) return 'too-long';
  return null;
}

export function assertLoginEmail(email: string): string {
  const normalized = normalizeLoginEmail(email);
  const rejection = loginEmailRejection(normalized);
  if (rejection === 'required') {
    throw new AppError('VALIDATION_ERROR', 'login e-mail is required', 400, { field: 'email' });
  }
  if (rejection === 'too-long') {
    throw new AppError('VALIDATION_ERROR', 'login e-mail exceeds 254 chars', 400, { field: 'email' });
  }
  return normalized;
}

export function storedLoginEmailFromTags(tags: readonly string[], mdmId: string): string | null {
  void mdmId;
  if (tags.length === 0) return null;
  const emails = new Set<string>();
  for (const tag of tags) {
    const normalized = normalizeLoginEmail(tag);
    if (loginEmailRejection(normalized) !== null) {
      throw new AppError('MDM_LOGIN_INVALID', 'Stored login e-mail is not valid', 409, { field: 'email' });
    }
    emails.add(normalized);
  }
  if (emails.size > 1) {
    throw new AppError('MDM_LOGIN_AMBIGUOUS', 'More than one login e-mail is linked to this person', 409, {
      field: 'mdmId',
    });
  }
  const [email] = emails;
  return email ?? null;
}
