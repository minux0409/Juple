export interface DeviceRegionalSettings {
  readonly preferredLocale: string;
  readonly timeZoneId: string;
}

export class DeviceRegionalSettingsError extends Error {
  constructor() {
    super('Device regional settings are unavailable.');
    this.name = 'DeviceRegionalSettingsError';
  }
}

export function getDeviceRegionalSettings(): DeviceRegionalSettings {
  const { locale, timeZone } = Intl.DateTimeFormat().resolvedOptions();

  if (!locale || !timeZone || locale.length > 35 || timeZone.length > 100) {
    throw new DeviceRegionalSettingsError();
  }

  return { preferredLocale: locale, timeZoneId: timeZone };
}
