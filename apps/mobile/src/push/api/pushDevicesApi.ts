import { ApiError } from '../../api/ApiError';
import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';

export type PushPlatform = 'android' | 'ios';

/** Mirrors PushDevicesController.PushDeviceRegistrationResponse (Backend, /api/v1/push/devices). Deliberately excludes the push token - the Backend never echoes it back either (see PushDeviceRegistration's own remarks on treating it as a secret). */
export interface PushDeviceRegistration {
  readonly id: number;
  readonly platform: PushPlatform;
  readonly installationId: string;
  readonly isEnabled: boolean;
  readonly updatedAtUtc: string;
}

export interface RegisterPushDeviceOptions {
  readonly platform: PushPlatform;
  readonly installationId: string;
  readonly pushToken: string;
  /** The app's currently-resolved UI language (e.g. "ko"/"en") - never the device's raw OS locale; see i18n/languagePreference.ts. Drives server-generated Push text (see Backend's PushNotificationTextGenerator). */
  readonly locale: string;
}

/** Idempotent register/re-register for one device install - safe to call again after a token refresh or an in-app language change. */
export async function registerPushDevice(
  request: AuthenticatedApiRequest,
  options: RegisterPushDeviceOptions,
): Promise<PushDeviceRegistration> {
  const response = await request<PushDeviceRegistration>({
    method: 'PUT',
    path: '/api/v1/push/devices',
    body: {
      platform: options.platform,
      installationId: options.installationId,
      pushToken: options.pushToken,
      locale: options.locale,
    },
  });

  if (!response.body) {
    throw new Error('Juple API returned no PushDeviceRegistration body.');
  }

  return response.body;
}

/** Called on logout - disables this installation's registration so it stops receiving Push for the signed-out user. Idempotent; resolves even if this installationId was never registered. */
export async function unregisterPushDevice(
  request: AuthenticatedApiRequest,
  installationId: string,
): Promise<void> {
  try {
    await request<void>({
      method: 'DELETE',
      path: `/api/v1/push/devices/${encodeURIComponent(installationId)}`,
    });
  } catch (error) {
    if (error instanceof ApiError && error.kind === 'notFound') {
      return;
    }
    throw error;
  }
}
