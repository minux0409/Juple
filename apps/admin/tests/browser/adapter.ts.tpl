export {PageState} from '../(admin)/AdminRoot';
import {ApiHttpError} from '../../lib/adminApi';
const seed={id:9,status:'Published',isImportant:false,isPinned:true,platforms:7,startsAtUtc:'2026-10-23T00:00:00Z',endsAtUtc:null,officialUrl:null,translations:[{language:'ko',title:'운영 공지',body:'본문'}],version:'AQ==',createdAtUtc:'2026-10-23T00:00:00Z',updatedAtUtc:'2026-10-23T00:00:00Z',readVersion:1};
const api=async(request:{method?:string;path:string;body?:object})=>{
 const calls=JSON.parse(sessionStorage.getItem('adminNoticeCalls')??'[]');calls.push(request);sessionStorage.setItem('adminNoticeCalls',JSON.stringify(calls));
 if(request.method==='DELETE'){sessionStorage.setItem('noticeDeleted','1');return undefined;}
 if(request.method==='PUT'||request.method==='POST'){const q=new URLSearchParams(location.search);if(q.has('slowSave'))await new Promise(resolve=>setTimeout(resolve,300));if(q.has('failSave'))throw new ApiHttpError(Number(q.get('failSave')), '서버 입력 검증 오류');const row={...seed,...request.body,version:'Ag=='};sessionStorage.setItem('noticeRow',JSON.stringify(row));return row;}
 const row=JSON.parse(sessionStorage.getItem('noticeRow')??'null')??seed;
 if(request.path.includes('/notices?')){const q=new URL(request.path,'https://fixture.invalid').searchParams;return {items:(!q.get('search')||row.translations[0].title.includes(q.get('search')))&&(!q.get('status')||row.status===q.get('status'))?[{...row,title:row.translations[0].title}]:[],nextCursor:null};}
 return row;
};
const value={api,reportFailure:()=>undefined};const router={replace:(url:string)=>{sessionStorage.setItem('adminNoticeNavigation',url);},refresh:()=>{sessionStorage.setItem('adminNoticeRefreshed','1');}};
export const useAdmin=()=>value;export const useRouter=()=>router;
