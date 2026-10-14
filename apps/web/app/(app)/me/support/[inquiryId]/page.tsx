import { InquiryDetail } from './InquiryDetail';

export default async function InquiryDetailPage({ params }: { params: Promise<{ inquiryId: string }> }) {
  const { inquiryId } = await params;
  return <InquiryDetail inquiryIdParam={inquiryId} />;
}
