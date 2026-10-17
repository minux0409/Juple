import { ANDROID_PACKAGE } from './shareLinks.ts';

/**
 * Where people get the Juple app - the ONE place (the sidebar card, the mobile landing and the public share page all read it).
 * Google Play is the real listing of the Android package (the same URL the app's own update policy opens). The App Store has no
 * listing yet: its URL comes only from configuration (APP_STORE_URL) and is never invented - without it the iPhone / App Store
 * button is shown as "coming soon", never as a link.
 */
export const ANDROID_PACKAGE_ID = ANDROID_PACKAGE;
export const DEFAULT_GOOGLE_PLAY_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE_ID}`;

export interface AppDownload {
  readonly googlePlayUrl: string;
  /** null = no App Store listing configured. */
  readonly appStoreUrl: string | null;
}

export function resolveAppDownload(env: { readonly googlePlayUrl?: string | undefined; readonly appStoreUrl?: string | undefined }): AppDownload {
  const https = (value: string | undefined) => (value && /^https:\/\//i.test(value.trim()) ? value.trim() : null);
  return { googlePlayUrl: https(env.googlePlayUrl) ?? DEFAULT_GOOGLE_PLAY_URL, appStoreUrl: https(env.appStoreUrl) };
}

export type MobileOs = 'android' | 'ios';

/**
 * A phone-sized mobile browser, from the User-Agent (server side, so the first paint is already right). Tablets and desktops - an
 * Android UA without "Mobile", an iPad - keep the ordinary Web, which is designed for a wide window. Used for the choice of
 * landing only; nothing is stored about the visitor.
 */
export function resolveMobileOs(userAgent: string | null | undefined): MobileOs | null {
  const ua = userAgent ?? '';
  if (/android/i.test(ua) && /mobile/i.test(ua)) {
    return 'android';
  }
  if (/iphone|ipod/i.test(ua)) {
    return 'ios';
  }
  return null;
}

export interface MobileLandingPlan {
  /** Android only: the explicit "open Juple" button (Chrome's intent link to the app's launcher screen). */
  readonly open: boolean;
  readonly googlePlay: boolean;
  /** A real App Store link. */
  readonly appStore: boolean;
  /** iPhone with no App Store listing configured yet: a disabled, honest "coming soon" button. */
  readonly appStoreSoon: boolean;
}

/**
 * What the mobile landing offers. An iPhone is never offered Google Play, an Android phone never the App Store. iOS has no "open"
 * button: Universal Links only apply to the share links (/c/...) and need the AASA file, which stays 404 until a real Apple Team ID
 * exists - there is no custom URL scheme to try instead.
 */
export function planMobileLanding(os: MobileOs, download: AppDownload): MobileLandingPlan {
  if (os === 'android') {
    return { open: true, googlePlay: true, appStore: false, appStoreSoon: false };
  }
  return { open: false, googlePlay: false, appStore: download.appStoreUrl !== null, appStoreSoon: download.appStoreUrl === null };
}

/**
 * Chrome's documented intent link that starts the installed app's launcher screen; if the app is not installed the browser stays on
 * `fallbackUrl` (the same page). No timer, no store redirect. Share links keep using androidOpenInAppUrl (lib/shareLinks.ts), which
 * opens the exact Collection - the app registers App Links only for /c/{publicId}.
 */
export function androidLaunchAppUrl(fallbackUrl: string): string {
  return `intent://#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=${ANDROID_PACKAGE_ID};S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end`;
}

/** The browser-side session flag of "웹에서 계속하기": the landing is skipped for this tab session only. */
export const CONTINUE_ON_WEB_KEY = 'juple.continueOnWeb';
