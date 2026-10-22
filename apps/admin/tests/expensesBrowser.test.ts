import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test(
  'real expense page: responsive dashboard, form create/edit/delete, filters, CSV/XLSX and evidence download',
  { timeout: 90_000 },
  async () => {
    const browser = [
      process.env.CHROME_BIN ?? '',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      '/usr/bin/chromium',
    ].find(existsSync);
    assert.ok(
      browser,
      'a local Chrome/Edge is required; never silently skip this workflow',
    );
    const dir = mkdtempSync(path.join(tmpdir(), 'juple-expense-ui-'));
    const loader = path.join(dir, 'loader.cjs');
    writeFileSync(
      loader,
      `const ts = require(${JSON.stringify(
        require.resolve('typescript'),
      )}); module.exports = function(source) { return ts.transpileModule(source, {fileName:this.resourcePath,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText; };`,
    );
    const shim = path.join(dir, 'AdminRoot.tsx');
    writeFileSync(
      shim,
      `import React from 'react'; export function useAdmin(){return {api:window.expenseApi,reportFailure:()=>undefined}} export function useAdminQuery(path){window.workspaceRequests.push(path);return {data:window.workspaceMode==='ready'?window.workspaceData:null,error:window.workspaceMode==='error'?'Fixture unavailable':null,loading:window.workspaceMode==='loading',reload:()=>{}}} export function PageState({error,loading}) {return <p role="status">{error || (loading?'Loading':'')}</p>}`,
    );
    const entry = path.join(dir, 'entry.tsx');
    writeFileSync(
      entry,
      `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {WorkspaceDates} from ${JSON.stringify(path.join(root, 'app/(admin)/workspace/WorkspaceDates.tsx'))};
    import {WorkspacePage} from ${JSON.stringify(path.join(root, 'app/(admin)/workspace/WorkspacePage.tsx'))};
    import ExpensesPage from ${JSON.stringify(
      path.join(root, 'app/(admin)/expenses/page.tsx'),
    )};
    window.expenseRequests=[]; window.downloads=[]; window.confirm=()=>true;
    const blobs = new Map(); const createURL=URL.createObjectURL.bind(URL); URL.createObjectURL=b=>{const u=createURL(b); blobs.set(u,b);return u};
    HTMLAnchorElement.prototype.click=function(){const blob=blobs.get(this.href);window.downloads.push({name:this.download,size:blob?.size});};
    let rows=[{expense:{id:1,requestId:'original',revision:1,name:'Azure invoice',provider:'Microsoft Azure',category:'Cloud',occurredOn:'2026-10-20',paidOn:'2026-10-20',currency:'KRW',grossAmount:'110',netAmount:'100',taxAmount:'10',paymentMethod:'card',status:'Paid',kind:'Charge',invoiceReference:'invoice-1',memo:null,convertedCurrency:null,exchangeRate:null,exchangeRateOn:null,originalExpenseId:null,source:'Manual',reconciledByExpenseId:null,noLongerReported:false},attachments:[{id:5,fileName:'receipt.pdf',contentType:'application/pdf',bytes:12,createdAtUtc:'2026-10-20T00:00:00Z'}]}];
    window.expenseApi=async request=>{
      window.expenseRequests.push(request); const url=new URL(request.path,'https://fixture.invalid');
      if(url.pathname.endsWith('/configuration'))return {enabled:true,azureSyncEnabled:false,evidenceScanningConfigured:false,azureScopes:[],pricing:{monthlyUsdReferencePrice:1.99,currency:'USD',trialDays:30}};
      if(request.responseType==='blob')return new Blob([url.searchParams.get('format')==='xlsx'?'PK-fixture':url.pathname.includes('attachments')?'%PDF-fixture':'Id,Name\\n1,fixture']);
      if(url.pathname.endsWith('/summary'))return {totals:[{currency:'KRW',status:'Paid',gross:110,net:100,tax:10,rows:1,missingEvidence:0,unknownTax:0},{currency:'USD',status:'Estimated',gross:99,net:null,tax:null,rows:1,missingEvidence:1,unknownTax:1}],months:[{currency:'KRW',status:'Paid',label:'2026-10',gross:110}],categories:[{currency:'KRW',status:'Paid',label:'Cloud',gross:110}],services:[]};
      if(url.pathname.endsWith('/due'))return [{expense:{...rows[0].expense,id:9,name:'Apple annual forecast',provider:'Apple',source:'Recurring',status:'Estimated',currency:'USD',grossAmount:'99',paidOn:null},attachments:[]}];
      if(url.pathname.endsWith('/schedules')||url.pathname.endsWith('/sync')||url.pathname.endsWith('/audit'))return [];
      if(request.method==='POST'){const row={expense:{...request.body.values,id:2,requestId:request.body.requestId,revision:1,source:'Manual'},attachments:[]};rows=[row,...rows];return row;}
      if(request.method==='PUT'){const row={expense:{...request.body.values,id:2,requestId:request.body.requestId,revision:request.body.expectedRevision+1,source:'Manual'},attachments:[]};rows=rows.map(r=>r.expense.id===2?row:r);return row;}
      if(request.method==='DELETE'){rows=rows.filter(r=>r.expense.id!==2);return;}
      return {items:rows,nextCursor:null};
    };
    const root=createRoot(document.getElementById('root')); root.render(<WorkspaceDates><ExpensesPage/></WorkspaceDates>);
    window.workspaceRequests=[];window.workspaceMode='ready';
    window.workspaceData={totalUsers:4,newUsers:2,liveLinks:10,savedLinks:3,uniqueSavers:2,activeUsers:2,dau:1,wau:2,mau:2,currentCollections:3,sharedCollections:1,openInquiries:0,activityTrackingSince:'2026-10-20',generatedAtUtc:'2026-10-22T01:00:00Z',
      series:Array.from({length:7},(_,i)=>({date:'2026-10-'+(16+i),signups:i===6?2:0,survivingAccountsToDate:i===6?4:2,linksSaved:i===6?3:0,linkSavers:i===6?2:0,survivingSavedLinksToDate:10,collectionsCreated:0,activeUsers:i<4?null:2})),
      platforms:[{platform:'Android',activeUsers:2},{platform:'Ios',activeUsers:0},{platform:'Web',activeUsers:1},{platform:'Unknown',activeUsers:0}],recentUsers:[],domains:[{domain:'example.test',links:3}],coverage:[{metric:'history',available:false,explanation:'현재 남아있는 기록 기준'}]};
    window.showWorkspace=mode=>{window.workspaceMode=mode;root.render(<WorkspaceDates><WorkspacePage/></WorkspaceDates>)};
  `,
    );
    const webpack = require('next/dist/compiled/webpack/webpack').webpack;
    await new Promise<void>((resolve, reject) =>
      webpack(
        {
          mode: 'development',
          plugins: [new (require('next/dist/compiled/webpack/webpack').webpack.DefinePlugin)({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) })],
          devtool: false,
          entry,
          output: { path: dir, filename: 'bundle.js' },
          resolve: {
            extensions: ['.tsx', '.ts', '.js'],
            modules: [path.join(root, 'node_modules'), 'node_modules'],
            alias: { '../AdminRoot$': shim },
          },
          module: { rules: [{ test: /\.tsx?$/, use: loader }] },
        },
        (
          error: Error | null,
          stats: { hasErrors(): boolean; toString(): string },
        ) =>
          error || stats.hasErrors()
            ? reject(error ?? new Error(stats.toString()))
            : resolve(),
      ),
    );
    const file = path.join(dir, 'expenses.html');
    writeFileSync(
      file,
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${readFileSync(
        path.join(root, 'app/globals.css'),
        'utf8',
      )}</style></head><body><main id="root" style="padding:16px;min-width:0"></main><script>window.fixtureErrors=[];window.addEventListener('error',e=>window.fixtureErrors.push(e.message));</script><script src="bundle.js"></script></body></html>`,
    );
    const profile = path.join(dir, 'profile');
    const child = spawn(
      browser,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        pathToFileURL(file).href,
      ],
      { stdio: 'ignore' },
    );
    let socket: WebSocket | undefined;
    try {
      const portFile = path.join(profile, 'DevToolsActivePort');
      for (let i = 0; i < 100 && !existsSync(portFile); i++) await delay(50);
      assert.ok(existsSync(portFile));
      const port = readFileSync(portFile, 'utf8').split(/\r?\n/)[0];
      const targets = (await (
        await fetch(`http://127.0.0.1:${port}/json/list`)
      ).json()) as { type: string; webSocketDebuggerUrl: string }[];
      socket = new WebSocket(
        targets.find(t => t.type === 'page')!.webSocketDebuggerUrl,
      );
      await new Promise<void>((resolve, reject) => {
        socket!.addEventListener('open', () => resolve(), { once: true });
        socket!.addEventListener('error', reject, { once: true });
      });
      let seq = 0;
      const pending = new Map<
        number,
        (result: {
          exceptionDetails?: unknown;
          result?: { value?: unknown };
        }) => void
      >();
      socket.addEventListener('message', event => {
        const m = JSON.parse(String(event.data));
        if (m.id) {
          pending.get(m.id)?.(m.result ?? m.error);
          pending.delete(m.id);
        }
      });
      const send = (method: string, params: Record<string, unknown> = {}) =>
        new Promise<{
          exceptionDetails?: unknown;
          result?: { value?: unknown };
        }>(resolve => {
          const id = ++seq;
          pending.set(id, resolve);
          socket!.send(JSON.stringify({ id, method, params }));
        });
      const evaluate = async (expression: string) => {
        const r = await send('Runtime.evaluate', {
          expression,
          returnByValue: true,
          awaitPromise: true,
        });
        assert.equal(r.exceptionDetails, undefined, JSON.stringify(r));
        return r.result?.value;
      };
      const settle = () =>
        evaluate('new Promise(resolve=>setTimeout(()=>resolve(true),80))');
      for (let i = 0; i < 60; i++) {
        if (await evaluate('document.querySelectorAll("tbody tr").length'))
          break;
        await delay(50);
      }
      assert.equal(
        await evaluate('document.querySelectorAll("tbody tr").length'),
        1,
        JSON.stringify(await evaluate('({errors:window.fixtureErrors,text:document.getElementById("root").textContent,requests:window.expenseRequests})')),
      );
      for (const width of [390, 1440]) {
        await send('Emulation.setDeviceMetricsOverride', {
          width,
          height: 900,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await settle();
        assert.ok(
          await evaluate('document.documentElement.scrollWidth<=innerWidth'),
          'ledger must not overflow viewport',
        );
      }
      assert.match(
        String(await evaluate('document.body.textContent')),
        /KRW[\s\S]*결제 완료/,
      );
      assert.match(
        String(await evaluate('document.body.textContent')),
        /USD[\s\S]*추정/,
      );
    assert.match(String(await evaluate('document.body.textContent')), /Apple annual forecast/);
      const click = async (text: string) => {
        await evaluate(
          `Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(
            text,
          )}).click()`,
        );
        await settle();
      };
      const input = async (label: string, value: string) => {
        await evaluate(
          `(()=>{const e=Array.from(document.querySelectorAll('label')).find(l=>l.textContent.startsWith(${JSON.stringify(
            label,
          )})).querySelector('input,textarea');Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(
            value,
          )});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
        );
        await settle();
      };
      await input('공급자', 'A&B=company');
      await click('조회');
      assert.ok(
        ((await evaluate('expenseRequests.map(r=>r.path)')) as string[]).some(
          p => p.includes('provider=A%26B%3Dcompany'),
        ),
      );
      await click('신규 비용');
      await input('비용 이름', 'Test tool');
      // The filter and editor both have 공급자 labels; scope editor inputs explicitly for this second form.
      await evaluate(
        `(()=>{const form=document.querySelector('form.card');for(const [label,value]of [['공급자','Company'],['결제 수단','card'],['통화','USD'],['합계','123456.123456123456']]){const e=Array.from(form.querySelectorAll('label')).find(l=>l.textContent.startsWith(label)).querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));}})()`,
      );
      await settle();
      await click('저장');
      assert.equal(
        await evaluate(
          'expenseRequests.find(r=>r.method==="POST").body.values.grossAmount',
        ),
        '123456.123456123456',
      );
      await click('열기');
      await click('수정');
      await input('메모', 'Changed memo');
      await click('저장');
      assert.equal(
        await evaluate(
          'expenseRequests.find(r=>r.method==="PUT").body.expectedRevision',
        ),
        1,
      );
      await click('CSV');
      await click('Excel');
      assert.deepEqual(
        await evaluate('downloads.map(d=>d.name.split(".").at(-1))'),
        ['csv', 'xlsx'],
      );
      await click('삭제');
      assert.ok(
        await evaluate(
          'expenseRequests.some(r=>r.method==="DELETE"&&r.path.includes("revision=2"))',
        ),
      );
      await click('열기');
      await click('다운로드');
      assert.equal(await evaluate('downloads.at(-1).name'), 'receipt.pdf');
      await evaluate("window.showWorkspace('ready')"); await settle();
      assert.match(String(await evaluate('document.getElementById("root").textContent')), /Overview[\s\S]*서비스 현황/);
      assert.equal(await evaluate('document.querySelectorAll("svg[role=img]").length'), 7);
      for (const width of [390, 768, 1440]) {
        await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false}); await settle();
        assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'), `workspace viewport ${width}`);
        if (width===1440) { const shot=await send('Page.captureScreenshot',{format:'png'}); writeFileSync(path.join(dir,'workspace-desktop.png'),Buffer.from((shot as unknown as {data:string}).data,'base64')); }
      }
      await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]}); await settle();
      assert.equal(await evaluate('getComputedStyle(document.body).backgroundColor'), 'rgb(20, 22, 26)');
      const shot=await send('Page.captureScreenshot',{format:'png'}); writeFileSync(path.join(dir,'workspace-dark.png'),Buffer.from((shot as unknown as {data:string}).data,'base64'));
      await click('오늘');
      assert.ok(await evaluate('(()=>{const p=new URL(workspaceRequests.at(-1),"https://fixture.invalid").searchParams;return p.get("from")===p.get("through")})()'));
      await evaluate("window.showWorkspace('loading')"); await settle();
      assert.equal(await evaluate('document.querySelectorAll(".skeleton").length'),4);
      await evaluate("window.showWorkspace('error')"); await settle();
      assert.match(String(await evaluate('document.querySelector("[role=alert]").textContent')),/Fixture unavailable/);
      assert.deepEqual(await evaluate('window.fixtureErrors'),[]);
    } finally {
      socket?.close();
      child.kill();
    }
  },
);
