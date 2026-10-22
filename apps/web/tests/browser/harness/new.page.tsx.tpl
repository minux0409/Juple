'use client';
import { useSearchParams } from 'next/navigation';
import { StubApp } from '../StubApp';
import { NewLinkReviewView } from '../../(app)/items/new/NewLinkReviewView';

export default function Page() {
  return (
    <StubApp>
      <NewLinkReviewView url={useSearchParams().get('url') ?? ''} />
    </StubApp>
  );
}
