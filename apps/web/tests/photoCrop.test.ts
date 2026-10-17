import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { getAppDictionary } from '../lib/appDictionary.ts';
import { APP_LANGUAGES } from '../lib/appI18n.ts';
import { CROP_OUTPUT_MAX, MAX_ZOOM, MIN_ZOOM, clampView, coverScale, cropRect, initialView, outputSide, panBy, zoomTo } from '../lib/imageCrop.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const V = 240;

describe('crop geometry', () => {
  it('zoom 1 covers the viewport exactly with the shorter side, centred (landscape and portrait)', () => {
    const landscape = initialView(4000, 3000, V);
    assert.equal(landscape.zoom, MIN_ZOOM);
    assert.equal(coverScale(4000, 3000, V), V / 3000);
    assert.ok(Math.abs(landscape.x - (V - 4000 * (V / 3000)) / 2) < 1e-9);
    assert.equal(landscape.y, 0);
    const portrait = initialView(1000, 2000, V);
    assert.equal(portrait.x, 0);
    assert.ok(Math.abs(portrait.y - (V - 2000 * (V / 1000)) / 2) < 1e-9);
  });

  it('the crop at zoom 1 is the centred square of the shorter side - 1:1 whatever the photo', () => {
    assert.deepEqual(cropRect(initialView(4000, 3000, V), 4000, 3000, V), { x: 500, y: 0, size: 3000 });
    assert.deepEqual(cropRect(initialView(1000, 2000, V), 1000, 2000, V), { x: 0, y: 500, size: 1000 });
    assert.deepEqual(cropRect(initialView(800, 800, V), 800, 800, V), { x: 0, y: 0, size: 800 });
  });

  it('panning never shows anything outside the photo (no empty strip), at any zoom', () => {
    const base = zoomTo(initialView(4000, 3000, V), 2, 4000, 3000, V);
    const far = panBy(base, 10_000, 10_000, 4000, 3000, V);
    assert.equal(far.x, 0);
    assert.equal(far.y, 0);
    const other = panBy(base, -10_000, -10_000, 4000, 3000, V);
    const scale = coverScale(4000, 3000, V) * 2;
    assert.ok(Math.abs(other.x - (V - 4000 * scale)) < 1e-9);
    assert.ok(Math.abs(other.y - (V - 3000 * scale)) < 1e-9);
    for (const view of [far, other]) {
      const rect = cropRect(view, 4000, 3000, V);
      assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.size <= 4000 && rect.y + rect.size <= 3000);
    }
    // at zoom 1 along the short side there is nothing to move
    assert.equal(panBy(initialView(4000, 3000, V), 0, 500, 4000, 3000, V).y, 0);
  });

  it('zoom is limited both ways; the point under the focus stays under it', () => {
    const start = initialView(2000, 2000, V);
    assert.equal(zoomTo(start, 0.2, 2000, 2000, V).zoom, MIN_ZOOM);
    assert.equal(zoomTo(start, 99, 2000, 2000, V).zoom, MAX_ZOOM);
    assert.equal(clampView({ zoom: Number.NaN, x: 0, y: 0 }, 2000, 2000, V).zoom, MIN_ZOOM);
    const focus = { x: 60, y: 90 };
    const zoomed = zoomTo(start, 2, 2000, 2000, V, focus);
    const photoBefore = { x: (focus.x - start.x) / coverScale(2000, 2000, V), y: (focus.y - start.y) / coverScale(2000, 2000, V) };
    const photoAfter = { x: (focus.x - zoomed.x) / (coverScale(2000, 2000, V) * 2), y: (focus.y - zoomed.y) / (coverScale(2000, 2000, V) * 2) };
    assert.ok(Math.abs(photoBefore.x - photoAfter.x) < 1e-6 && Math.abs(photoBefore.y - photoAfter.y) < 1e-6);
    // a higher zoom shows a smaller square
    assert.ok(cropRect(zoomed, 2000, 2000, V).size < cropRect(start, 2000, 2000, V).size);
  });

  it('the exported side is the crop itself, never enlarged and never above what the server keeps (512)', () => {
    assert.equal(CROP_OUTPUT_MAX, 512);
    assert.equal(outputSide(3000), 512);
    assert.equal(outputSide(300), 300);
    assert.equal(outputSide(0), 1);
  });

  it('a small photo is handled (crop never larger than the photo)', () => {
    const rect = cropRect(initialView(100, 60, V), 100, 60, V);
    assert.deepEqual(rect, { x: 20, y: 0, size: 60 });
  });
});

describe('crop dialog flow (Web)', () => {
  const dialog = source('app/(app)/PhotoCropDialog.tsx');
  const profile = source('app/(app)/me/ProfileEditView.tsx');

  it('a picked file opens the crop first; Cancel changes nothing; Apply hands the cropped file on - the upload stays the existing 저장', () => {
    assert.match(profile, /setError\(null\);\s*setCropSource\(file\);/);
    assert.doesNotMatch(profile, /setError\(null\);\s*setPickedPhoto\(file\);/);
    assert.match(profile, /onApply=\{cropped => \{\s*setCropSource\(null\);\s*setPickedPhoto\(cropped\);/);
    assert.match(profile, /onCancel=\{\(\) => setCropSource\(null\)\}/);
    // the dialog itself never calls the API
    assert.doesNotMatch(dialog, /api<|fetch\(|PROFILE_IMAGE_PATH/);
    // the upload is still PUT of the form with the (now cropped) file
    assert.match(profile, /path: PROFILE_IMAGE_PATH, body: profilePhotoForm\(pickedPhoto\)/);
  });

  it('the result is the square the viewport shows: drawn from the crop rectangle into a square canvas, JPEG, no metadata, on white', () => {
    assert.match(dialog, /const rect = cropRect\(view, size\.width, size\.height, VIEWPORT\);/);
    assert.match(dialog, /canvas\.width = side;\s*canvas\.height = side;/);
    assert.match(dialog, /drawImage\(image, rect\.x, rect\.y, rect\.size, rect\.size, 0, 0, side, side\)/);
    assert.match(dialog, /'image\/jpeg',\s*0\.92/);
    assert.match(dialog, /fillStyle = '#ffffff'/);
  });

  it('a second Apply while one runs is ignored; the buttons are disabled meanwhile', () => {
    assert.match(dialog, /if \(busyRef\.current \|\| !image \|\| !size \|\| !view\) \{\s*return;/);
    assert.match(dialog, /disabled=\{busy \|\| !view \|\| failed\}/);
    assert.match(dialog, /<button className=\{styles\.settingsAction\} disabled=\{busy\} onClick=\{onCancel\}/);
  });

  it('mouse, touch and pinch (pointer events), wheel (non-passive), and the keyboard (arrows, + / -) all move or zoom; a slider zooms', () => {
    for (const handler of ['onPointerDown', 'onPointerMove', 'onPointerUp', 'onPointerCancel', 'onKeyDown']) {
      assert.match(dialog, new RegExp(handler));
    }
    assert.match(dialog, /addEventListener\('wheel', onWheel, \{ passive: false \}\)/);
    assert.match(dialog, /case 'ArrowLeft'/);
    assert.match(dialog, /case '\+'/);
    assert.match(dialog, /type="range"/);
    assert.match(dialog, /tabIndex=\{0\}/);
  });

  it('it is a Modal (native dialog): title, focus kept inside, Escape and the close button cancel', () => {
    assert.match(dialog, /<Modal closeLabel=\{dictionary\.cancel\} onClose=\{onCancel\} open=\{file !== null\} title=\{dictionary\.profileCropTitle\}>/);
    assert.match(source('app/(app)/Modal.tsx'), /showModal\(\)/);
    assert.match(source('app/(app)/Modal.tsx'), /onCancel=\{event => \{\s*event\.preventDefault\(\);\s*onClose\(\);/);
  });

  it('Light / Dark: only tokens; the photo is never filtered or dimmed; the circle mask uses the scrim token', () => {
    const css = source('app/(app)/app.module.css');
    const block = css.slice(css.indexOf('.cropBody {'));
    assert.match(block, /\.cropImage \{[^}]*filter: none;[^}]*opacity: 1;/);
    assert.match(block, /\.cropMask \{[^}]*var\(--scrim\)/);
    assert.match(block, /\.cropViewport \{[^}]*background: var\(--app-surface-muted\)/);
    assert.doesNotMatch(block.replace(/rgba\(255, 255, 255, 0\.85\)/, ''), /#[0-9a-f]{3,6}\b/i);
  });

  it('the strings exist in all 17 languages', () => {
    for (const language of APP_LANGUAGES) {
      const words = getAppDictionary(language);
      for (const key of ['profileCropTitle', 'profileCropHint', 'profileCropNote', 'profileCropZoom', 'profileCropApply', 'profileCropPreview', 'profileCropAreaA11y'] as const) {
        assert.ok(words[key].trim().length > 0, `${language}.${key}`);
        assert.doesNotMatch(words[key], /\{\{|undefined/);
      }
    }
    assert.equal(getAppDictionary('ko').profileCropHint, '사진을 움직이고 확대해서 원하는 영역을 맞춰주세요.');
  });
});

describe('temporary object URLs (Web)', () => {
  const hook = source('app/(app)/useObjectUrl.ts');

  it('one hook creates and revokes them: with the file change, on unmount, and never while the same URL is still used', () => {
    assert.match(hook, /URL\.createObjectURL\(file\)/);
    assert.match(hook, /URL\.revokeObjectURL\(url\)/);
    // the development double-run of an effect must not revoke a URL still on screen: the revoke is deferred and cancelled on reuse
    assert.match(hook, /clearTimeout\(pending\)/);
    assert.match(hook, /setTimeout\(/);
    for (const path of ['app/(app)/PhotoCropDialog.tsx', 'app/(app)/me/ProfileEditView.tsx']) {
      const text = source(path);
      assert.match(text, /useObjectUrl\(/, path);
      assert.doesNotMatch(text, /URL\.createObjectURL|URL\.revokeObjectURL/, `${path} manages no URL by hand`);
    }
  });

  it('the wheel listener is removed again, and no canvas outlives one Apply', () => {
    const dialog = source('app/(app)/PhotoCropDialog.tsx');
    assert.match(dialog, /return \(\) => element\.removeEventListener\('wheel', onWheel\);/);
    assert.equal((dialog.match(/document\.createElement\('canvas'\)/g) ?? []).length, 1);
  });

  it('a photo smaller than 512 is exported as it is (never enlarged), and nothing is refused for being small', () => {
    assert.equal(outputSide(300), 300);
    assert.equal(outputSide(511), 511);
    assert.match(source('app/(app)/PhotoCropDialog.tsx'), /const side = outputSide\(rect\.size\);/);
  });
});
