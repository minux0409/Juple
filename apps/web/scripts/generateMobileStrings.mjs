// Regenerates lib/appI18nMobile.generated.ts from the mobile locale files and lib/appI18nMobileKeys.ts (one key per line).
// Usage (from apps/web): node scripts/generateMobileStrings.mjs [--check]
//   --check  compares with the committed file and exits 1 when they differ (nothing is written).
// The rules are the ones the generated file's header states: the mobile text in every one of the 17 languages, {{x}} becomes {x},
// and a key missing in a language takes English (the mobile fallback).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const keysSource = readFileSync(join(root, 'lib', 'appI18nMobileKeys.ts'), 'utf8');
const entries = [...keysSource.matchAll(/^\s{2}([A-Za-z0-9_]+):\s*'([^']+)',/gm)].map(match => [match[1], match[2]]);
const languages = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant', 'es', 'fr', 'de', 'it', 'pt-BR', 'vi', 'th', 'id', 'ru', 'tr', 'ar', 'hi'];
const localeDir = join(root, '..', 'mobile', 'src', 'i18n', 'locales');

const read = language => JSON.parse(readFileSync(join(localeDir, `${language}.json`), 'utf8').replace(/^﻿/, ''));
const lookup = (tree, path) => path.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), tree);
const english = read('en');

const existing = readFileSync(join(root, 'lib', 'appI18nMobile.generated.ts'), 'utf8');
const headerEnd = existing.indexOf('export const MOBILE_STRINGS');
let out = existing.slice(0, headerEnd) + 'export const MOBILE_STRINGS: Readonly<Record<AppLanguage, Readonly<Record<MobileStringKey, string>>>> = {\n';
for (const language of languages) {
  const tree = language === 'en' ? english : read(language);
  out += `  '${language}': {\n`;
  for (const [webKey, mobileKey] of entries) {
    const raw = lookup(tree, mobileKey) ?? lookup(english, mobileKey);
    if (typeof raw !== 'string') {
      throw new Error(`mobile key ${mobileKey} (web key ${webKey}) has no English text`);
    }
    out += `    ${webKey}: ${JSON.stringify(raw.replace(/\{\{(\w+)\}\}/g, '{$1}'))},\n`;
  }
  out += '  },\n';
}
out += '};\n';

if (process.argv.includes('--check')) {
  const same = out.replace(/\r\n/g, '\n') === existing.replace(/\r\n/g, '\n');
  console.log(same ? 'generated file is up to date' : 'generated file DIFFERS');
  process.exit(same ? 0 : 1);
}
writeFileSync(join(root, 'lib', 'appI18nMobile.generated.ts'), out, 'utf8');
console.log(`wrote ${entries.length} keys x ${languages.length} languages`);
