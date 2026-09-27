import { cookies } from 'next/headers';
import { getPublicCollectionItems, LOCKED } from '../../../../lib/publicApi';
import { isValidPublicId, unlockCookieName } from '../../../../lib/unlockCookie';

const ITEMS_PAGE_LIMIT = 50;

function resolveApiBaseUrl(): string {
  return process.env.JUPLE_API_BASE_URL || 'http://localhost:5092';
}

/**
 * Same-origin "load more" for a locked share: the unlock grant is an HttpOnly cookie the browser
 * cannot read, so pagination goes through here, where the grant is attached server-side. Returns
 * exactly the public page shape (title/url/previewImageUrl only) or a plain status - never the
 * grant itself.
 */
export async function GET(request: Request, { params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  if (!isValidPublicId(publicId)) {
    return new Response(null, { status: 404 });
  }

  const cursor = new URL(request.url).searchParams.get('cursor') ?? undefined;
  const unlockToken = (await cookies()).get(unlockCookieName(publicId))?.value;

  const page = await getPublicCollectionItems(resolveApiBaseUrl(), publicId, {
    cursor,
    limit: ITEMS_PAGE_LIMIT,
    unlockToken,
  });

  if (page === null) {
    return new Response(null, { status: 404 });
  }
  if (page === LOCKED) {
    return new Response(null, { status: 403 });
  }

  return Response.json(page, { headers: { 'Cache-Control': 'no-store' } });
}
