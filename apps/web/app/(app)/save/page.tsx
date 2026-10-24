import { NewLinkReviewView } from '../items/new/NewLinkReviewView';

type Search = { url?: string | string[]; title?: string | string[]; image?: string | string[] };

/**
 * 링크 저장 - the one place a link is reviewed and saved (typed on Home, or taken from someone else's shared link). Its own path, not
 * /items/new, so a client-side navigation here is never taken by the Quick Detail slot (see lib/newLink.ts openReview).
 */
export default async function SaveLinkPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const single = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '');
  const url = single(search.url);
  const title = single(search.title);
  const image = single(search.image);
  return <NewLinkReviewView image={image} key={`${url}|${title}|${image}`} title={title} url={url} />;
}
