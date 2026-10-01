// Node's own fs, read synchronously - this app ships no Node type definitions, so only the one
// function used is typed here.
const { readFileSync } = require('fs') as { readFileSync: (path: string, encoding: 'utf8') => string };
declare const __dirname: string;

// Juple's orientation policy, checked statically. The app's own screens are designed portrait-only,
// so the app locks itself to portrait - which is entirely separate from the phone's system 화면
// 자동 회전 (accelerometer_rotation) setting: nothing in the app or its scripts may ever change that
// user preference. (A device-tool cause was found for it turning on: `adb shell monkey`, used once
// to launch the app after installs, freezes and then thaws rotation, writing the setting - launch
// with `adb shell am start -n com.juple.app/.MainActivity` instead.)
const mobileRoot = `${__dirname}/..`;
const manifest = readFileSync(`${mobileRoot}/android/app/src/main/AndroidManifest.xml`, 'utf8');
const infoPlist = readFileSync(`${mobileRoot}/ios/JupleMobile/Info.plist`, 'utf8');
const packageJson = JSON.parse(readFileSync(`${mobileRoot}/package.json`, 'utf8')) as { scripts: Record<string, string> };

function activityBlock(name: string): string {
  const start = manifest.indexOf(`android:name="${name}"`);
  if (start === -1) {
    throw new Error(`${name} is not declared`);
  }
  return manifest.slice(manifest.lastIndexOf('<activity', start), manifest.indexOf('>', start));
}

function plistArray(key: string): string[] {
  const match = new RegExp(`<key>${key.replace('~', '\\~')}</key>\\s*<array>([\\s\\S]*?)</array>`).exec(infoPlist);
  return match ? [...match[1].matchAll(/<string>([^<]+)<\/string>/g)].map(entry => entry[1]) : [];
}

describe('orientation policy', () => {
  it('Android: the one UI Activity is locked to portrait', () => {
    expect(activityBlock('.MainActivity')).toMatch(/android:screenOrientation="portrait"/);
  });

  it('Android: the app never asks for the permission to change system settings (auto-rotate included)', () => {
    expect(manifest).not.toMatch(/WRITE_SETTINGS|WRITE_SECURE_SETTINGS/);
  });

  it('iOS: iPhone is portrait-only too (the iPad entry is the template default - see the report)', () => {
    expect(plistArray('UISupportedInterfaceOrientations')).toEqual(['UIInterfaceOrientationPortrait']);
  });

  it('no project script changes the device rotation setting or launches through Monkey', () => {
    const scripts = Object.values(packageJson.scripts).join('\n');
    expect(scripts).not.toMatch(/accelerometer_rotation|user_rotation|settings put|wm user-rotation|\bmonkey\b/);
  });
});

export {};
