/**
 * Container Apps liveness/readiness probe (infra/azure/admin/main.bicep): 200 "ok" as long as the Next.js process serves requests.
 * No sign-in, no API call, no configuration read - it says nothing about the Juple API (운영 > 시스템 상태 shows that).
 */
export const dynamic = 'force-static';

export function GET(): Response {
  return new Response('ok', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
