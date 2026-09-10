import { SafeAreaProvider } from 'react-native-safe-area-context';
// i18next.init() already ran as a side effect of index.js importing ./App before registering any
// AppRegistry component (both roots share one JS bundle/module graph) - imported again here only
// so this root never silently depends on that ordering if it's ever registered independently.
import '../../i18n';
import { QuickSaveComposerScreen } from './QuickSaveComposerScreen';

interface QuickSaveComposerRootProps {
  readonly pendingShareId?: string;
}

/** AppRegistry root for QuickSaveComposerActivity - see index.js. Deliberately has no AuthProvider, React Navigation, or other MainActivity-only providers; see useQuickSaveComposer.ts for why none of those are needed here. */
export function QuickSaveComposerRoot({ pendingShareId }: QuickSaveComposerRootProps) {
  return (
    <SafeAreaProvider>
      <QuickSaveComposerScreen pendingShareId={pendingShareId ?? null} />
    </SafeAreaProvider>
  );
}
