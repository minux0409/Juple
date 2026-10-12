import { NewLinkReviewView } from './NewLinkReviewView';

export default async function NewLinkPage({ searchParams }: { searchParams: Promise<{ url?: string | string[] }> }) {
  const { url } = await searchParams;
  const value = typeof url === 'string' ? url : '';
  return <NewLinkReviewView key={value} url={value} />;
}
