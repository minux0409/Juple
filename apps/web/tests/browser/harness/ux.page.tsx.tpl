 'use client';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SignedInAppContext } from '../(app)/AppRoot';
import { ToastProvider } from '../(app)/Toaster';
import { TourProvider, useTour } from './TourProvider';
import { ReceivedRequestsDialog } from '../(app)/collections/ReceivedRequestsDialog';
import { PhotoEditor } from '../(app)/PhotoEditor';
import { HomeRecentLinks } from '../(app)/HomeRecentLinks';
import { UnlockPanel } from '../(app)/collections/[collectionId]/UnlockPanel';
import { FriendPicker } from '../(app)/collections/[collectionId]/FriendPicker';
import { getAppDictionary } from '../../lib/appDictionary';
import { ApiHttpError } from '../../lib/appApi';
import styles from '../(app)/app.module.css';
export default function Page() {
 const query = useSearchParams();
 const [photo, setPhoto] = useState(true);
 const [picker, setPicker] = useState(false);
 const value = useMemo(() => ({dictionary: getAppDictionary('ko'),locale:'ko',account:{homeAccountId:'fixture'},isNewAccount:query.get('fixtureTour')==='new',onSessionLost(){},
  api: async (request: {path:string; method?:string; body?:unknown}) => {
   const calls=JSON.parse(sessionStorage.getItem('calls') || '[]'); calls.push(request); sessionStorage.setItem('calls',JSON.stringify(calls));
   if(request.path.endsWith('/join-requests')) return {items:[{requestId:1,jupleId:'ABCD2345',displayName:'아주 긴 참여 요청자 이름이 카드 너비를 넘거나 버튼과 겹치지 않도록 확인합니다',requestedAtUtc:'2026-10-24T00:00:00Z',profileImageUrl:null}],nextCursor:null};
   if(request.path.includes('/unlock')) throw new ApiHttpError(403,'invalidCollectionPassword');
   if(request.path.includes('/friends')) return {items:Array.from({length:22},(_,i)=>({friendshipId:i+1,jupleId:`TEST${String(i).padStart(4,'0')}`,displayName:`Friend ${i+1}`,profileImageUrl:null})),nextCursor:null};
   if(request.path.endsWith('/share/link/send')) {const ids=(request.body as {jupleIds:string[]}).jupleIds; return {sent:ids.slice(0,-1),skipped:[ids.at(-1)],notFound:[]};}
   if(request.path.includes('/recently-opened-links')) return {items:Array.from({length:10},(_,i)=>({itemId:10-i,url:`https://example.com/${i}`,title:`Recent ${10-i}`,lastOpenedAtUtc:'2026-10-24T00:00:00Z'}))};
   return {items:[],nextCursor:null};
  }}),[]);
 if (query.get('fixtureRequests')) return <SignedInAppContext.Provider value={value as never}><div className={styles.shell}><ReceivedRequestsDialog collection={{id:5,name:'Collection'}} open onClose={()=>undefined} onChanged={()=>undefined}/></div></SignedInAppContext.Provider>;
 if (query.get('fixtureTour')) return <SignedInAppContext.Provider value={value as never}><TourFixture /></SignedInAppContext.Provider>;
 return <SignedInAppContext.Provider value={value as never}><ToastProvider><div className={styles.shell} data-theme={query.get('theme') || 'light'}><main className={styles.content}><div className={styles.contentInner}>
 <h1>Local UX fixture</h1>
 <div data-photo><PhotoEditor hasPhoto={photo} busy={false} changeLabel={photo?'사진 변경':'사진 추가'} removeLabel="사진 삭제" onChange={()=>setPhoto(true)} onRemove={()=>setPhoto(false)}><div style={{width:'100%',height:180}}>Representative photo</div></PhotoEditor></div>
 <HomeRecentLinks mode="image" reloadToken={0} onOpenOriginal={()=>undefined}/>
 <header>Collection header retained</header><div className={styles.collectionGateCenter} data-gate><UnlockPanel collectionId={5} kind="lock" isOwner={query.get('owner')==='1'} onUnlocked={()=>undefined} onStateChanged={()=>undefined}/></div>
 <button data-open-picker onClick={()=>setPicker(true)}>Choose friends</button><FriendPicker open={picker} collectionId={5} referral unavailable={new Map()} onClose={()=>setPicker(false)} onInvited={()=>undefined}/>
 </div></main></div></ToastProvider></SignedInAppContext.Provider>;
}

function TourFixture() {
 return <TourProvider><GuideContent /></TourProvider>;
}
function GuideContent() {
 const {start}=useTour();
 return <div className={styles.shell} data-guide-ready><input data-tour-id="home.input" aria-label="Link"/><button data-manual-guide onClick={()=>start('mainOnboarding')}>Manual guide</button></div>;
}
