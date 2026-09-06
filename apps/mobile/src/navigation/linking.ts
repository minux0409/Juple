import type { LinkingOptions } from '@react-navigation/native';
import { publicWebConfig } from '../config/publicWebConfig';
import type { RootStackParamList } from './RootStack';

/**
 * HTTPS-only deep linking for the Public Collection Sharing link
 * (https://<host>/c/{publicId} -> SharedCollection, see screens/SharedCollectionScreen.tsx).
 *
 * Deliberately never lists the Microsoft Entra External ID OAuth redirect's custom scheme
 * (com.juple.app.auth://oauthredirect, see android/app/build.gradle's appAuthRedirectScheme and
 * ios/JupleMobile/Info.plist's CFBundleURLSchemes) as a prefix here - that redirect is consumed
 * entirely by react-native-app-auth's own in-app-browser session, never by React Navigation, and
 * adding it to this config could make React Navigation try to resolve it as a route instead.
 *
 * If JUPLE_PUBLIC_WEB_HOST isn't configured (no real production domain yet - see
 * config/publicWebConfig.ts), prefixes is empty. That is a safe no-op, not a crash: the app still
 * opens and every existing screen still works, it just never receives an HTTPS deep link.
 */
export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: publicWebConfig.host ? [`https://${publicWebConfig.host}`] : [],
  config: {
    screens: {
      SharedCollection: 'c/:publicId',
    },
  },
};
