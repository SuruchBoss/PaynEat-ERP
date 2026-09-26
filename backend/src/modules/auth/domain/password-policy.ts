/**
 * NIST SP 800-63B style password policy: length is what matters, plus a block-list of
 * obviously guessable values. Character-class rotation is deliberately not forced — it
 * pushes people toward `Password1!` and quarterly increments.
 *
 * Adapted from Cwork (backend/src/modules/auth/password.policy.ts), see NOTICE: pure
 * here, returning the problems instead of throwing, so the service decides how to refuse.
 */
const COMMON_PASSWORDS = new Set([
  'password',
  'password123',
  '123456789012',
  'qwertyuiop12',
  'administrator',
  'letmein12345',
  'welcome12345',
  'friedchicken',
  'payneaterp123',
]);

export interface PasswordPolicyInput {
  password: string;
  minLength: number;
  email?: string;
}

/** Problems with the password, in English for the API; empty when it is acceptable. */
export function passwordProblems({ password, minLength, email }: PasswordPolicyInput): string[] {
  const problems: string[] = [];

  if (password.length < minLength) {
    problems.push(`must be at least ${minLength} characters`);
  }
  if (password.length > 256) {
    problems.push('must be at most 256 characters');
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    problems.push('is too common');
  }
  if (/^(.)\1+$/.test(password)) {
    problems.push('must not be a single repeated character');
  }
  const localPart = email?.split('@')[0]?.toLowerCase();
  if (localPart && localPart.length >= 4 && password.toLowerCase().includes(localPart)) {
    problems.push('must not contain your email address');
  }

  return problems;
}
