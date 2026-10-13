import { readLegalOperatorConfig } from '../../../../lib/legalConfig';
import { CustomerCenter } from './CustomerCenter';

/**
 * 고객센터 - read on the server so 문의하기 uses the same configured contact mailbox as the public legal pages (LEGAL_SUPPORT_EMAIL, else
 * the confirmed one); only that address reaches the browser.
 */
export default function SupportPage() {
  return <CustomerCenter supportEmail={readLegalOperatorConfig().supportEmail ?? null} />;
}
