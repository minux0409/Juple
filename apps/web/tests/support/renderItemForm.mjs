/**
 * Renders the REAL ItemForm components (ItemFormLayout / ItemFormSections / ItemCollectionsSection / ItemMemoSection and the real
 * CollectionPicker inside) to static HTML, with the app's real stylesheet, so a headless browser can measure what is actually laid
 * out. Not a route and not shipped: the components are transpiled on the fly (TypeScript's own transpileModule), CSS-module class
 * names are the source names (so app.module.css applies as written), and only the signed-in context and next/* are stubbed.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cache = new Map();

const classNames = new Proxy({}, { get: (_target, name) => (typeof name === 'string' && name !== '__esModule' ? name : undefined) });
const passthrough = new Proxy(function stub() {}, { get: () => passthrough, apply: () => null });

function resolveFile(from, specifier) {
  const base = path.resolve(path.dirname(from), specifier);
  for (const candidate of [base, `${base}.tsx`, `${base}.ts`, path.join(base, 'index.tsx'), path.join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }
  throw new Error(`Cannot resolve ${specifier} from ${from}`);
}

function load(file, context) {
  if (file.endsWith('.css')) {
    return classNames;
  }
  if (file.endsWith(`${path.sep}AppRoot.tsx`)) {
    return { useSignedInApp: () => context };
  }
  if (cache.has(file)) {
    return cache.get(file).exports;
  }
  const output = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: file,
  }).outputText;
  const record = { exports: {} };
  cache.set(file, record);
  const localRequire = specifier => {
    if (specifier.startsWith('.')) {
      return load(resolveFile(file, specifier), context);
    }
    if (specifier === 'next/link') {
      return { __esModule: true, default: ({ href, children, ...rest }) => React.createElement('a', { href: String(href), ...rest }, children) };
    }
    if (specifier === 'next/navigation') {
      return { usePathname: () => '/', useRouter: () => ({ push() {}, replace() {}, back() {} }), useSearchParams: () => new URLSearchParams() };
    }
    if (specifier.startsWith('next/')) {
      return passthrough;
    }
    return require(specifier);
  };
  new Function("require", "module", "exports", output)(localRequire, record, record.exports);
  return record.exports;
}

/** The stylesheet + markup of a Collections section followed by a memo section, inside the real form card. */
export function renderItemFormHtml({ width = 1440 } = {}) {
  const entry = path.join(webRoot, 'app', '(app)', 'ItemForm.tsx');
  const dictionaryModule = load(path.join(webRoot, 'lib', 'appDictionary.ts'), null);
  const context = { api: async () => undefined, dictionary: dictionaryModule.getAppDictionary('ko'), locale: 'ko', onSessionLost: () => undefined };
  const form = load(entry, context);
  const collections = [1, 2, 3, 4, 5, 6, 7, 8].map(id => ({ id, name: `컬렉션 ${id}`, icon: 'Folder', color: null, itemCount: id, isFavorite: false, isLocked: id === 2 }));
  const element = React.createElement(
    form.ItemFormLayout,
    { onSubmit: () => undefined },
    React.createElement(
      form.ItemFormSections,
      null,
      React.createElement(form.ItemCollectionsSection, {
        destinations: collections,
        failed: false,
        selectedIds: new Set([1]),
        onToggle: () => undefined,
        session: { remember() {}, tokenFor: () => null, isUnlocked: () => false, forget() {}, clear() {} },
        onUnavailable: () => undefined,
        onRefreshed: () => undefined,
      }),
      React.createElement(form.ItemMemoSection, { value: '', onChange: () => undefined }),
    ),
  );
  const css = readFileSync(path.join(webRoot, 'app', '(app)', 'app.module.css'), 'utf8');
  const globals = readFileSync(path.join(webRoot, 'app', 'globals.css'), 'utf8');
  const markup = renderToStaticMarkup(element);
  const script = `
    const rect = element => element.getBoundingClientRect();
    const title = document.querySelector('h2');
    const search = document.querySelector('input[type="search"]').parentElement;
    const tile = document.querySelector('button[aria-pressed]');
    const memoTitle = document.querySelector('label > span');
    const memoArea = document.querySelector('textarea');
    const section = title.parentElement;
    const card = document.querySelector('form > div');
    document.title = JSON.stringify({
      width: window.innerWidth,
      cardPaddingTop: rect(title).top - rect(card).top - 1,
      titleToSearch: rect(search).top - rect(title).bottom,
      searchToTiles: rect(tile).top - rect(search).bottom,
      sectionToMemoTitle: rect(memoTitle).top - rect(section).bottom,
      memoTitleToArea: rect(memoArea).top - rect(memoTitle).bottom,
      cardPaddingBottom: rect(card).bottom - rect(memoArea).bottom - 1,
    });`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=${width}"><style>${globals}</style><style>${css}</style></head><body><div class="shell"><main class="content"><div class="contentInner">${markup}</div></main></div><script>${script}</script></body></html>`;
}

/**
 * Any real component(s) inside the real shell + stylesheet, for a screenshot: `build(loadFile, React)` returns the element, where
 * `loadFile('app/(app)/PageHeader.tsx')` gives that module's exports.
 */
export function renderPageHtml(build, { width = 1440, locale = 'ko' } = {}) {
  const dictionaryModule = load(path.join(webRoot, 'lib', 'appDictionary.ts'), null);
  const context = { api: async () => undefined, dictionary: dictionaryModule.getAppDictionary(locale), locale, onSessionLost: () => undefined };
  const element = build(relative => load(path.join(webRoot, relative), context), React);
  const css = readFileSync(path.join(webRoot, 'app', '(app)', 'app.module.css'), 'utf8');
  // Not globals.css: it carries the public viewer's UNHASHED class names (e.g. .collectionName), which in the app never meet the
  // module's hashed ones - with raw names here they would collide.
  const globals = '*,*::before,*::after{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif}';
  const markup = renderToStaticMarkup(element);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=${width}"><style>${globals}</style><style>${css}</style></head><body><div class="shell"><main class="content"><div class="contentInner">${markup}</div></main></div></body></html>`;
}
