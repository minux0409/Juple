import { connection } from 'next/server';
import { adminEnvFromProcess, readAdminConfig } from '../../lib/adminConfig';
import { AdminRoot } from './AdminRoot';

/**
 * Every admin page. Rendered per request so the configuration is read from the RUNTIME environment, and only the public names in
 * ADMIN_CONFIG_ENV reach the browser. Pages are Client Components that render nothing until AdminRoot has the API's confirmation
 * (GET /api/v1/admin/me) - and every number on them comes from an API call that the API authorizes again on its own.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const result = readAdminConfig(adminEnvFromProcess());
  return <AdminRoot config={result.ok ? result.config : null}>{children}</AdminRoot>;
}
