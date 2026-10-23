import i18n, { SUPPORTED_LANGUAGES } from '../index';

describe('archive request failure copy', () => {
  it.each(SUPPORTED_LANGUAGES)('%s provides distinct network and server errors without falling back to English', language => {
    const translate = i18n.getFixedT(language);
    const network = translate('history.errorNetwork');
    const server = translate('history.errorServer');
    expect(i18n.hasResourceBundle(language, 'translation')).toBe(true);
    expect(i18n.getResource(language, 'translation', 'history.errorNetwork')).toBe(network);
    expect(i18n.getResource(language, 'translation', 'history.errorServer')).toBe(server);
    expect(network.trim().length).toBeGreaterThan(0);
    expect(server).not.toBe(network);
    if (language !== 'en') {
      expect(network).not.toBe(i18n.getFixedT('en')('history.errorNetwork'));
      expect(server).not.toBe(i18n.getFixedT('en')('history.errorServer'));
    }
  });

  it('retains the configured English fallback for an unsupported language', () => {
    const unknown = i18n.getFixedT('nl');
    expect(unknown('history.errorNetwork')).toBe(i18n.getFixedT('en')('history.errorNetwork'));
    expect(unknown('history.errorServer')).toBe(i18n.getFixedT('en')('history.errorServer'));
    expect(i18n.options.fallbackLng).toEqual(['en']);
  });
});
