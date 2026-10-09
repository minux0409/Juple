/**
 * The app's version policy, as the backend delivers it in the bootstrap response (`mobileVersionPolicy`). The app carries NO
 * version numbers of its own: whether an update is available or required is decided here by comparing the installed BUILD
 * number (Android versionCode / iOS CFBundleVersion - authoritative; the display version string is informational only) with
 * what the server says for the current platform. Changing the policy is a server configuration change, not an app release.
 */

export interface PlatformVersionPolicy {
  /** The newest build in the store. */
  readonly latestBuild: number;
  /** The oldest build still allowed to run. 0 = nothing is forced. */
  readonly minimumSupportedBuild: number;
  /** The store page, when the server configured one (https). */
  readonly storeUrl: string | null;
}

export interface MobileVersionPolicy {
  readonly android: PlatformVersionPolicy | null;
  readonly ios: PlatformVersionPolicy | null;
}

export type AppUpdateStatus = 'current' | 'optional' | 'required';

const isBuildNumber = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

function parsePlatform(raw: unknown): PlatformVersionPolicy | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  if (!isBuildNumber(value.latestBuild) || !isBuildNumber(value.minimumSupportedBuild) || value.minimumSupportedBuild > value.latestBuild) {
    return null;
  }
  const storeUrl = typeof value.storeUrl === 'string' && /^https:\/\/\S+$/i.test(value.storeUrl.trim()) ? value.storeUrl.trim() : null;
  return { latestBuild: value.latestBuild, minimumSupportedBuild: value.minimumSupportedBuild, storeUrl };
}

/**
 * Reads the bootstrap `mobileVersionPolicy` defensively. Anything absent, malformed or self-contradictory (an older backend, a
 * newer shape, a minimum above the latest) is null for that platform - and null means "no policy", never a guess: a broken or
 * missing answer must not nag or block anybody.
 */
export function parseMobileVersionPolicy(raw: unknown): MobileVersionPolicy | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const android = parsePlatform(value.android);
  const ios = parsePlatform(value.ios);
  return android === null && ios === null ? null : { android, ios };
}

/**
 * current: the installed build is the latest (or newer - e.g. a test build ahead of the store), or there is no usable policy.
 * optional: supported but older than the latest - an update is offered.
 * required: below the minimum supported build - the app must be updated to be used.
 * An unknown installed build (not a number) is "current": the app never blocks on something it cannot read.
 */
export function evaluateAppUpdate(policy: PlatformVersionPolicy | null, installedBuild: number | null): AppUpdateStatus {
  if (policy === null || installedBuild === null || !Number.isFinite(installedBuild)) {
    return 'current';
  }
  if (policy.minimumSupportedBuild > 0 && installedBuild < policy.minimumSupportedBuild) {
    return 'required';
  }
  if (policy.latestBuild > 0 && installedBuild < policy.latestBuild) {
    return 'optional';
  }
  return 'current';
}

export function platformPolicy(policy: MobileVersionPolicy | null, platform: string): PlatformVersionPolicy | null {
  if (policy === null) {
    return null;
  }
  return platform === 'android' ? policy.android : platform === 'ios' ? policy.ios : null;
}

/** The installed build number from the native app info (a digit string), or null when it cannot be read. */
export function parseInstalledBuild(build: string | null | undefined): number | null {
  if (typeof build !== 'string' || !/^\d+$/.test(build.trim())) {
    return null;
  }
  return Number.parseInt(build.trim(), 10);
}
