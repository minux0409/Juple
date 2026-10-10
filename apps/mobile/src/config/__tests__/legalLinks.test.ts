import { buildLegalLinks } from '../legalLinks';

describe('buildLegalLinks', () => {
  it('has no links without a public web host', () => {
    expect(buildLegalLinks(undefined)).toEqual({ termsUrl: null, privacyUrl: null });
    expect(buildLegalLinks('')).toEqual({ termsUrl: null, privacyUrl: null });
    expect(buildLegalLinks('   ')).toEqual({ termsUrl: null, privacyUrl: null });
  });

  it('builds HTTPS links on the configured host', () => {
    expect(buildLegalLinks('dev.juple.co.kr')).toEqual({
      termsUrl: 'https://dev.juple.co.kr/terms',
      privacyUrl: 'https://dev.juple.co.kr/privacy',
    });
  });

  it('refuses anything that is not a bare host', () => {
    for (const bad of ['https://dev.juple.co.kr', 'dev.juple.co.kr/path', 'a b.test', '-x.test']) {
      expect(buildLegalLinks(bad)).toEqual({ termsUrl: null, privacyUrl: null });
    }
  });
});
