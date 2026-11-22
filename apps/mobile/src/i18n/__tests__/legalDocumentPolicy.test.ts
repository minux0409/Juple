import { legalDocumentLink, legalFallbackNotices, legalLanguage } from '../legalDocumentPolicy';
import { parsePublishedTerms } from '../../safety/termsDocument';
import published from '../../../../../backend/src/Juple.Application/Safety/PublishedTerms.json';

describe('legal document reading language is not consent language', () => {
  it.each(Object.keys(legalFallbackNotices))('%s keeps the chosen language in all legal links', language => {
    for (const path of ['terms', 'privacy', 'account-deletion']) {
      expect(legalDocumentLink(`https://juple.co.kr/${path}`, language)).toBe(`https://juple.co.kr/${path}?language=${language}`);
    }
    expect(legalFallbackNotices[legalLanguage(language)].length).toBeGreaterThan(10);
  });
  it('never accepts a fallback body as a translation', () => {
    expect(parsePublishedTerms({ ...published, requestedLanguage: 'ar', canAccept: true }, published.version)).toBeNull();
    expect(parsePublishedTerms({ ...published, requestedLanguage: 'ar', canAccept: false }, published.version)?.language).toBe('ko');
  });
});
