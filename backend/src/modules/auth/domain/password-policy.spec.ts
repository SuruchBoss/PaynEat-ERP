import { passwordProblems } from './password-policy';

const policy = (password: string, email?: string) =>
  passwordProblems({ password, minLength: 12, email });

describe('passwordProblems', () => {
  it('accepts a long passphrase', () => {
    expect(policy('crispy wings every friday')).toEqual([]);
  });

  it('refuses short, common and repeated passwords', () => {
    expect(policy('short')).toContain('must be at least 12 characters');
    expect(policy('Password123')).toEqual(
      expect.arrayContaining(['must be at least 12 characters', 'is too common']),
    );
    expect(policy('administrator')).toContain('is too common');
    expect(policy('aaaaaaaaaaaaaaaa')).toContain('must not be a single repeated character');
    expect(policy('x'.repeat(257))).toContain('must be at most 256 characters');
  });

  it('refuses a password that contains the email address', () => {
    expect(policy('somchai-is-great-2026', 'somchai@demo-chicken.example')).toContain(
      'must not contain your email address',
    );
    // A very short local part would refuse too much; it is not checked.
    expect(policy('the bob of all trades', 'bob@demo-chicken.example')).toEqual([]);
  });
});
