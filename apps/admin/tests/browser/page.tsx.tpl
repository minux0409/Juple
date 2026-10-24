 'use client';
import {useEffect} from 'react';
import {useSearchParams} from 'next/navigation';
import {NoticeEditor} from './NoticeEditor';
import List from './NoticeList';
export default function Page(){const q=useSearchParams();useEffect(()=>{document.documentElement.dataset.noticeFixtureReady='1';},[]);return q.has('list')?<List/>:<NoticeEditor id={q.has('new')?undefined:9}/>;}
