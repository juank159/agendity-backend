import {
  consentLinkSecret,
  signConsentToken,
  verifyConsentToken,
} from './consent-token';

describe('token del link de consentimiento (11.06)', () => {
  const payload = {
    jti: '11111111-1111-4111-8111-111111111111',
    clientId: '22222222-2222-4222-8222-222222222222',
    tenantId: '33333333-3333-4333-8333-333333333333',
    expiresAt: new Date('2031-01-01T00:00:00Z'),
  };
  const token = signConsentToken(payload, 'secreto');

  it('ida y vuelta con el mismo secreto', () => {
    expect(verifyConsentToken(token, 'secreto')).toEqual(payload);
  });

  it('otro secreto, firma o datos alterados, formato raro → null', () => {
    expect(verifyConsentToken(token, 'otro')).toBeNull();
    const [v, body, sig] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(body, 'base64url').toString()),
        t: 'x',
      }),
    ).toString('base64url');
    expect(verifyConsentToken(`${v}.${forged}.${sig}`, 'secreto')).toBeNull();
    expect(
      verifyConsentToken(`${v}.${body}.${sig.slice(1)}`, 'secreto'),
    ).toBeNull();
    for (const bad of ['', 'v1', 'v2.a.b', 'v1.a.b.c', 'x'.repeat(700)]) {
      expect(verifyConsentToken(bad, 'secreto')).toBeNull();
    }
  });

  it('secreto: el propio; sin él, derivado del JWT (nunca igual); en producción, obligatorio', () => {
    expect(consentLinkSecret({ CONSENT_LINK_SECRET: 'propio' })).toBe('propio');
    const derived = consentLinkSecret({ SECRET_KEY_JWT: 'jwt' });
    expect(derived).not.toBe('jwt');
    expect(derived).toHaveLength(64);
    expect(() =>
      consentLinkSecret({ NODE_ENV: 'production', SECRET_KEY_JWT: 'jwt' }),
    ).toThrow(/CONSENT_LINK_SECRET/);
  });
});
