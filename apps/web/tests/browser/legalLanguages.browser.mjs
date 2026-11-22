// Run against a locally running Production image, never next dev or authenticated PROD accounts.
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { findChrome, openPage, closeAllPages } from './cdp.mjs';

const origin = process.env.JUPLE_LEGAL_TEST_ORIGIN;
if (origin && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) throw new Error('Legal UI tests require an isolated local Production image');
const chrome = findChrome();
after(closeAllPages);
describe('public legal languages in the Production image', { skip: !origin || !chrome }, () => {
  it('renders Korean, English and Arabic at 320/393/1280px; keeps fallback body LTR and links localized', async () => {
    const page = await openPage(chrome, `${origin}/terms?language=ko`, 9463);
    try {
      for (const width of [320, 393, 1280]) {
        await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
        for (const language of ['ko', 'en', 'ar']) {
          for (const slug of ['terms', 'privacy', 'account-deletion']) {
            await page.send('Page.navigate', { url: `${origin}/${slug}?language=${language}` });
            await page.until(`document.querySelector('main.legalMain')?.lang === '${language}' && document.querySelector('select[name=language]')?.value === '${language}'`);
            const state = await page.evaluate(`(() => { const m=document.querySelector('main.legalMain'), a=m.querySelector('article'); return {dir:m.dir, bodyLanguage:a.lang, bodyDirection:a.dir, fallback:!!m.querySelector('[data-legal-fallback]'), fallbackText:m.querySelector('[data-legal-fallback]')?.textContent, options:m.querySelector('select').options.length, overflow:document.documentElement.scrollWidth > innerWidth + 1, links:[...m.querySelectorAll('.legalNav a')].map(a=>a.href), consentButtons:m.querySelectorAll('[data-agreement-next]').length}; })()`);
            assert.equal(state.dir, language === 'ar' ? 'rtl' : 'ltr');
            assert.equal(state.bodyLanguage, 'ko');
            assert.equal(state.bodyDirection, 'ltr');
            assert.equal(state.fallback, language !== 'ko');
            assert.equal(state.options, 17);
            assert.equal(state.overflow, false, `${width}/${language}/${slug} overflows`);
            assert.equal(state.consentButtons, 0);
            assert.ok(state.links.every(link => new URL(link).searchParams.get('language') === language));
          }
        }
      }
    } finally { await page.close(); }
  });
});
