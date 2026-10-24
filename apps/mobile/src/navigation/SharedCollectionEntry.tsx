import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, type ReactNode } from 'react';
import { SharedCollectionScreen } from '../screens/SharedCollectionScreen';
import { themedScreen } from '../theme/ThemeContext';
import type { RootStackParamList } from './RootStack';

const Screen = themedScreen(SharedCollectionScreen);

/** Keep the link in the navigator while startup runs. A restored token alone does not mean that
 * CollectionDetails is registered: bootstrap, terms and permission onboarding must finish first.
 * The same route survives startup failures/retries and sign-in; no URL/session is persisted here.
 */
export function SharedCollectionEntry({ ready, fallback, ...props }: NativeStackScreenProps<RootStackParamList, 'SharedCollection'> & {
  readonly ready: boolean;
  readonly fallback: ReactNode;
}) {
  useEffect(() => {
    // Bounded lifecycle diagnostics only: no URLs, collection identifiers or credentials.
    console.info('[Juple shared link] startup', { ready });
  }, [ready]);
  return ready ? <Screen {...props} /> : fallback;
}
