// Local Mock browser test for the real CollectionsView + invitation modal; never contacts PROD or Azure DEV.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, it } from 'node:test';
import { findChrome, openPage } from './cdp.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const harness = `${root}app/ux-test-harness`;
const origin = 'http://localhost:3197';
let server;
let owned = false;
before(async () => {
  assert.ok(findChrome(), 'Chrome is required for this explicit browser test');
  assert.equal(existsSync(harness), false, 'Preserve any existing harness directory');
  mkdirSync(harness);
  owned = true;
  copyFileSync(`${root}tests/browser/harness/ux.page.tsx.tpl`, `${harness}/page.tsx`);
  // Exercise the real guide state/effects in Chrome; isolate only its route adapter from the test-only URL.
  const guideSource=readFileSync(`${root}app/(app)/TourProvider.tsx`,'utf8')
    .replace("from 'next/navigation'", "from './navigationStub'")
    .replace("from './AppRoot'", "from '../(app)/AppRoot'")
    .replace("from './app.module.css'", "from '../(app)/app.module.css'");
  writeFileSync(`${harness}/TourProvider.tsx`,guideSource);
  writeFileSync(`${harness}/navigationStub.ts`,"const router={push() {},replace() {},back() {}}; export const useRouter=()=>router; export const usePathname=()=>'/';");
  server = spawn(process.execPath, [`${root}node_modules/next/dist/bin/next`, 'dev', '-p', '3197'], { cwd: root, stdio: 'ignore', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
  for (let attempt = 0; attempt < 90; attempt++) {
    try { if ((await fetch(`${origin}/ux-test-harness`)).status === 200) return; } catch { /* local startup */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Local Mock server startup timeout');
});
after(async () => {
  if (owned) {
    unlinkSync(`${harness}/page.tsx`);
    unlinkSync(`${harness}/TourProvider.tsx`);
    unlinkSync(`${harness}/navigationStub.ts`);
    rmdirSync(harness);
    // Let Next's watcher regenerate its dev route types before stopping it. Otherwise tsc
    // would retain an import of the test route that has just been removed. Keep other build files.
    for (let attempt = 0; attempt < 30; attempt++) {
      const validator = `${root}.next/dev/types/validator.ts`;
      if (!existsSync(validator) || !readFileSync(validator, 'utf8').includes('ux-test-harness')) break;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  if (server && process.platform === 'win32') {
    await new Promise(resolve => spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' }).on('close', resolve));
  } else server?.kill();
});
let nextChromePort = 9640;
const openFixture = url => openPage(findChrome(), url, nextChromePort++);
const capture = async (tab, name) => {
  if (!process.env.INVITATION_SCREENSHOT_DIR) return;
  await tab.evaluate(`document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))`);
  mkdirSync(process.env.INVITATION_SCREENSHOT_DIR, { recursive: true });
  const screenshot = await tab.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(process.env.INVITATION_SCREENSHOT_DIR, `${name}.png`), Buffer.from(screenshot.result.data, 'base64'));
};

for (const width of [1280,393,320]) for (const theme of ['light','dark']) {
 it(`photo overlay, recent list/grid and centered lock at ${width}px ${theme}`, async()=>{
  const tab=await openFixture(`${origin}/ux-test-harness?theme=${theme}&owner=${width===1280?1:0}`);
  try {
   await tab.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
   await tab.until(`document.querySelector('[data-home-recent] ul')?.children.length===10`);
   await tab.evaluate(`document.documentElement.dataset.theme='${theme}'`);
   assert.equal(await tab.evaluate(`document.documentElement.scrollWidth<=innerWidth`),true);
   await tab.evaluate(`document.querySelector('[data-photo] button').focus()`);
   await tab.wait(200);
   assert.equal(await tab.evaluate(`getComputedStyle(document.querySelector('[data-photo] button').parentElement).opacity`),'1');
   assert.equal(await tab.evaluate(`(()=>{const f=document.querySelector('[data-photo]').getBoundingClientRect();return [...document.querySelectorAll('[data-photo] button')].every(b=>{const r=b.getBoundingClientRect();return r.top>=f.top&&r.bottom<=f.bottom;});})()`),true);
   await tab.evaluate(`document.querySelectorAll('[data-photo] button')[1].click()`);
   await tab.until(`document.querySelector('[data-photo]').textContent.includes('사진 추가')`);
   assert.equal(await tab.evaluate(`document.querySelectorAll('[data-photo] button').length`),1);
   assert.equal(await tab.evaluate(`(()=>{const u=document.querySelector('[data-home-recent] ul'),s=u.parentElement;return s.scrollHeight>s.clientHeight&&s.clientHeight<=480;})()`),true);
   await tab.evaluate(`document.querySelector('[data-home-recent] button[aria-label="그리드 보기"]').click()`);
   await tab.until(`document.querySelector('[data-home-recent] ul').className.includes('linkGrid')`);
   assert.equal(await tab.evaluate(`document.querySelector('[data-home-recent] ul li a').textContent.includes('Recent 10')`),true);
   const centered=await tab.evaluate(`(()=>{const a=document.querySelector('[data-gate]').getBoundingClientRect(),b=document.querySelector('[data-gate] form').getBoundingClientRect();return Math.abs((a.left+a.right-b.left-b.right)/2)<2&&Math.abs((a.top+a.bottom-b.top-b.bottom)/2)<2;})()`);
   assert.equal(centered,true);
   await capture(tab,`ux-${width}-${theme}`);
  }finally{await tab.close();}
 });
}
it('member friend picker caps selection at 20 and posts one formal batch, keeping the failed target selected',async()=>{
 const tab=await openFixture(`${origin}/ux-test-harness`);
 try{
  await tab.until(`document.querySelector('[data-home-recent] ul')?.children.length===10`);
  await tab.evaluate(`document.querySelector('[data-open-picker]').click()`);
  await tab.until(`document.querySelectorAll('[data-friend-picker-layout] button[aria-pressed]').length>20`);
  await tab.evaluate(`[...document.querySelectorAll('[data-friend-picker-layout] button[aria-pressed]')].filter(b=>b.textContent.includes('Friend ')).forEach(b=>b.click())`);
  await tab.until(`document.querySelector('dialog[open]').textContent.includes('20')`);
  assert.equal(await tab.evaluate(`document.querySelectorAll('[data-friend-picker-layout] button[aria-pressed="true"]').length`),20);
  await tab.evaluate(`[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent.includes('20')&&b.textContent.includes('추가')).click()`);
  await tab.until(`JSON.parse(sessionStorage.getItem('calls')).some(c=>c.path.endsWith('/share/link/send'))`);
  const calls=await tab.evaluate(`JSON.parse(sessionStorage.getItem('calls')).filter(c=>c.method==='POST')`);
  assert.equal(calls.length,1); assert.equal(calls[0].path,'/api/v1/collections/5/share/link/send'); assert.equal(calls[0].body.jupleIds.length,20);
  await tab.until(`document.querySelectorAll('[data-friend-picker-layout] button[aria-pressed="true"]').length===1`);
 }finally{await tab.close();}
});

it('new account guide runs once; skip and completion are recorded; existing accounts use manual replay',async()=>{
 const tab=await openFixture(`${origin}/ux-test-harness?fixtureTour=new`);
 const receipt='juple.tour.mainOnboarding.v1.fixture';
 try{
  await tab.until(`!!document.querySelector('[data-tour-overlay]')`);
  await tab.evaluate(`document.querySelector('[data-tour-skip]').click()`);
  await tab.until(`!document.querySelector('[data-tour-overlay]')`);
  assert.equal(await tab.evaluate(`localStorage.getItem('${receipt}')`),'skipped');
  const firstDocument=await tab.evaluate('performance.timeOrigin');
  await tab.send('Page.navigate',{url:`${origin}/ux-test-harness?fixtureTour=new`});
  await tab.until(`performance.timeOrigin!==${firstDocument} && !!document.querySelector('[data-guide-ready]')`);
  await tab.wait(600);
  assert.equal(await tab.evaluate(`!!document.querySelector('[data-tour-overlay]')`),false);
  await tab.evaluate(`document.querySelector('[data-manual-guide]').click()`);
  await tab.until(`!!document.querySelector('[data-tour-overlay]')`);
  for(let step=0;step<4;step++) {
   await tab.evaluate(`document.querySelector('[data-tour-next]')?.click()`);
   await tab.wait(200);
  }
  await tab.until(`!document.querySelector('[data-tour-overlay]')`);
  assert.equal(await tab.evaluate(`localStorage.getItem('${receipt}')`),'completed');
  const secondDocument=await tab.evaluate('performance.timeOrigin');
  await tab.send('Page.navigate',{url:`${origin}/ux-test-harness?fixtureTour=existing`});
  await tab.until(`performance.timeOrigin!==${secondDocument} && !!document.querySelector('[data-guide-ready]')`);
  await tab.wait(600);
  assert.equal(await tab.evaluate(`!!document.querySelector('[data-tour-overlay]')`),false);
 }finally{await tab.close();}
});

for (const width of [1280,393,320]) it(`received join request heading and long name at ${width}px`,async()=>{
 const tab=await openFixture(`${origin}/ux-test-harness?fixtureRequests=1`);
 try {
  await tab.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
  await tab.until(`!!document.querySelector('[data-join-request-id]')`);
  assert.equal(await tab.evaluate(`getComputedStyle(document.querySelector('dialog[open] h3')).paddingInlineStart`),'12px');
  assert.equal(await tab.evaluate(`document.documentElement.scrollWidth<=innerWidth`),true);
  assert.equal(await tab.evaluate(`(()=>{const card=document.querySelector('[data-join-request-id]').getBoundingClientRect();return [...document.querySelectorAll('[data-join-request-id] button')].every(b=>{const r=b.getBoundingClientRect();return r.left>=card.left&&r.right<=card.right;});})()`),true);
  await capture(tab,`join-heading-${width}`);
 }finally{await tab.close();}
});
