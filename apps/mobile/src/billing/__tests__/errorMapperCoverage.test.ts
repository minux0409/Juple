export {};

const fs = jest.requireActual<{ readFileSync(file: string, encoding: string): string; readdirSync(dir: string, options: { withFileTypes: true }): { name: string; isDirectory(): boolean }[] }>('fs');
const path = jest.requireActual<{ join(...parts: string[]): string }>('path');

const SRC = path.join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' || entry.name === 'node_modules' ? [] : sourceFiles(full);
    }
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });
}

describe('every screen error mapper honours the handled subscription refusal', () => {
  const mappers: { file: string; name: string; body: string }[] = [];
  for (const file of sourceFiles(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    const pattern = /function (get\w*Error\w*Message)\(\s*error: unknown[^{]*?\)\s*:\s*string\s*\{/g;
    let match: RegExpExecArray | null = pattern.exec(text);
    while (match) {
      mappers.push({ file: file.slice(SRC.length + 1), name: match[1], body: text.slice(match.index + match[0].length, match.index + match[0].length + 160) });
      match = pattern.exec(text);
    }
  }

  it('finds the mappers (the scan itself works)', () => {
    expect(mappers.length).toBeGreaterThan(25);
  });

  it('each one starts with the shared guard, so a new mapper cannot forget it', () => {
    const missing = mappers
      .filter(mapper => !/^\s*if \(isHandledSubscriptionRefusal\(error\)\) \{\s*return '';/.test(mapper.body))
      .map(mapper => `${mapper.file}: ${mapper.name}`);
    expect(missing).toEqual([]);
  });
});
