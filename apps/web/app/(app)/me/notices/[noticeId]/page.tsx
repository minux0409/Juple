import { notFound } from 'next/navigation';
import { NoticesView } from '../NoticesView';
export default async function NoticePage({
  params,
}: {
  params: Promise<{ noticeId: string }>;
}) {
  const { noticeId } = await params;
  const id = Number(noticeId);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  return <NoticesView key={id} id={id} />;
}
