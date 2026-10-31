import Link from 'next/link';

/** 문의 관리's two tabs. Reports are a tab here, not a sidebar item of their own, but they are separate data from inquiries. */
export function InquiryTabs({ active }: { readonly active: 'inquiries' | 'reports' }) {
  return (
    <nav aria-label="문의 관리 구분" className="v2-segmented">
      <Link aria-current={active === 'inquiries' ? 'page' : undefined} href="/inquiries">일반 문의</Link>
      <Link aria-current={active === 'reports' ? 'page' : undefined} href="/inquiries/reports">신고 관리</Link>
    </nav>
  );
}
