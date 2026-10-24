 'use client';
import {useEffect,useMemo} from 'react';
import {useSearchParams} from 'next/navigation';
import {SignedInAppContext} from '../(app)/AppRoot';
import {NoticesView} from '../(app)/me/notices/NoticesView';
import {NoticeBadge} from '../(app)/me/notices/NoticeBadge';
import {getAppDictionary} from '../../lib/appDictionary';
import {ApiHttpError} from '../../lib/appApi';
import styles from '../(app)/app.module.css';
import {useTheme} from '../_components/ThemeProvider';
export default function Page(){const query=useSearchParams();const id=query.has('detail')?1:undefined;
 const {preference,setPreference}=useTheme();
 useEffect(()=>{const requested=query.get('theme')==='dark'?'dark':'light';if(preference!==requested)setPreference(requested);},[query,preference,setPreference]);
 const value=useMemo(()=>({dictionary:getAppDictionary('ko'),locale:'ko',onSessionLost(){},api:async({path,method,body}:{path:string;method?:string;body?:unknown})=>{
  const calls=JSON.parse(sessionStorage.getItem('noticeCalls')??'[]');calls.push({path,method,body});sessionStorage.setItem('noticeCalls',JSON.stringify(calls));
  const read=sessionStorage.getItem('noticeRead')==='1';
  if(path.includes('/unread'))return {hasUnread:!read};
  if(method==='PUT'){if(query.has('failRead'))throw new ApiHttpError(503,null);sessionStorage.setItem('noticeRead','1');return undefined;}
  if(path.startsWith('/api/v1/notices?')&&query.has('failList'))throw new ApiHttpError(503,null);
  if(path.startsWith('/api/v1/notices?')&&query.has('empty'))return {items:[],nextCursor:null};
  const item={id:1,language:'ko',title:'아주 긴 공지사항 제목도 작은 화면에서 자연스럽게 줄바꿈됩니다',preview:'새로운 소식과 서비스 안내 미리보기입니다.',publishedAtUtc:'2026-10-24T00:00:00Z',isPinned:true,isImportant:false,isRead:read,readVersion:1};
  if(path.startsWith('/api/v1/notices/1?')&&sessionStorage.getItem('noticeDeleted')==='1')throw new ApiHttpError(404,null);
  if(path.startsWith('/api/v1/notices/1?'))return {notice:item,body:'첫 번째 문단\n\n- 목록 항목\n2. 번호 목록\n[공식 도움말](https://juple.co.kr/help)\n<script>window.noticeXss=true</script>',officialUrl:'https://juple.co.kr/help'};
  return {items:[path.includes('cursor=')?{...item,id:2,title:'두 번째 공지'}:item],nextCursor:path.includes('cursor=')?null:'page2'};
 }}),[query]);
 return <SignedInAppContext.Provider value={value as never}><div className={styles.shell}><main className={styles.main} style={{gridColumn:'1 / -1'}}><div data-badge><NoticeBadge/></div><NoticesView key={id??'list'} id={id}/></main></div></SignedInAppContext.Provider>;
}
