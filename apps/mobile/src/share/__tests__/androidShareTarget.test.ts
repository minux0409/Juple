// Node's own fs, read synchronously - this app ships no Node type definitions, so only the one
// function used is typed here.
const { readFileSync } = require('fs') as { readFileSync: (path: string, encoding: 'utf8') => string };
declare const __dirname: string;

// Static checks of what makes Juple a normal Android Sharesheet target for a shared link (e.g. a
// YouTube video's "Share" → text/plain with the URL in EXTRA_TEXT). Where Juple appears in the
// Sharesheet (first row vs. "More") is ranked by the OS/launcher from the user's own usage and
// cannot be set by the app - these only guard that Juple stays a correct candidate at all.
const androidMain = `${__dirname}/../../../android/app/src/main`;
const manifest = readFileSync(`${androidMain}/AndroidManifest.xml`, 'utf8');
const shortcuts = readFileSync(`${androidMain}/res/xml/shortcuts.xml`, 'utf8');

function activityBlock(name: string): string {
  const start = manifest.indexOf(`android:name="${name}"`);
  const end = manifest.indexOf('</activity>', start);
  const match = start === -1 || end === -1 ? null : [manifest.slice(manifest.lastIndexOf('<activity', start), end)];
  if (!match) {
    throw new Error(`${name} is not declared`);
  }
  return match[0];
}

describe('Android share target (ShareReceiverActivity)', () => {
  const receiver = activityBlock('.ShareReceiverActivity');

  it('is exported and receives ACTION_SEND text/plain with CATEGORY_DEFAULT', () => {
    expect(receiver).toMatch(/android:exported="true"/);
    const filters = receiver.match(/<intent-filter>[\s\S]*?<\/intent-filter>/g) ?? [];
    const sendFilter = filters.find(filter => filter.includes('android.intent.action.SEND"'));
    expect(sendFilter).toBeDefined();
    expect(sendFilter).toMatch(/<category android:name="android\.intent\.category\.DEFAULT"\s*\/>/);
    expect(sendFilter).toMatch(/<data android:mimeType="text\/plain"\s*\/>/);
  });

  it('shows as the app itself - its own label and launcher icon, never a blank or custom name', () => {
    expect(receiver).not.toMatch(/android:label=/);
    expect(receiver).not.toMatch(/android:icon=/);
    expect(manifest).toMatch(/<application[\s\S]*?android:label="@string\/app_name"/);
    expect(manifest).toMatch(/<application[\s\S]*?android:icon="@mipmap\/ic_launcher"/);
  });

  it('Direct Share targets are only the user\'s own Collections, bound to the same text/plain filter', () => {
    expect(receiver).toMatch(/android:name="android\.app\.shortcuts"[\s\S]*?android:resource="@xml\/shortcuts"/);
    expect(shortcuts).toMatch(/<share-target android:targetClass="com\.juple\.app\.ShareReceiverActivity">/);
    expect(shortcuts).toMatch(/<data android:mimeType="text\/plain"\s*\/>/);
    // No static shortcuts: nothing is published just to push Juple up the Sharesheet.
    expect(shortcuts.replace(/<!--[\s\S]*?-->/g, '')).not.toMatch(/<shortcut[\s>]/);
  });
});
