import { notFound } from 'next/navigation';
import { NoticeEditor } from '../NoticeEditor';
export default async function EditNoticePage({
  params,
}: {
  params: Promise<{ noticeId: string }>;
}) {
  const { noticeId } = await params;
  const id = Number(noticeId);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  return <NoticeEditor key={id} id={id} />;
}
