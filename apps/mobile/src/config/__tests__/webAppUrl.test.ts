import { buildWebAppUrl } from '../webAppUrl';

describe('buildWebAppUrl', () => {
  it('opens the production site when the build has no public web host', () => {
    expect(buildWebAppUrl(undefined)).toBe('https://juple.co.kr');
    expect(buildWebAppUrl('  ')).toBe('https://juple.co.kr');
  });

  it("opens the build's own web host", () => {
    expect(buildWebAppUrl('dev.juple.co.kr')).toBe('https://dev.juple.co.kr');
  });

  it('never builds anything but a plain https origin from a malformed host', () => {
    for (const bad of ['https://evil.test', 'evil.test/path?token=1', 'a b.test', '-x.test']) {
      expect(buildWebAppUrl(bad)).toBe('https://juple.co.kr');
    }
  });
});
