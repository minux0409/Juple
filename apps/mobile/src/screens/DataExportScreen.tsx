import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '../components/Pressable';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { reauthenticateSameAccount } from '../auth/reauthentication';
import { LoadFailureState } from '../components/LoadFailureState';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import {
  createDataExportLinks,
  downloadUrl,
  formatMegabytes,
  getDataExportSummary,
  type DataExportFileLink,
  type DataExportLinks,
  type DataExportSummary,
} from '../dataExport/dataExportApi';
import { cardShadow, colors, minTouchTarget, radii, spacing, themedStyles } from '../theme/tokens';

type SummaryState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly summary: DataExportSummary }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'failed'; readonly cause: unknown };

/**
 * 계정 관리 / 구독 > 데이터 내보내기: what an export of the person's own data contains (counts from the server), then - after a fresh
 * sign-in the server asks for - one short-lived download link per file: the data file (links, memos, Collections, comments, purchases)
 * and numbered photo files. Each link opens in the system browser, which downloads the ZIP into the device's downloads (Android) or
 * Files (iOS) - no in-app file handling, no new native dependency. Works in every subscription state, read-only included.
 */
export function DataExportScreen() {
  const { t, i18n } = useTranslation();
  const request = useAuthenticatedApi();
  const [summaryState, setSummaryState] = useState<SummaryState>({ kind: 'loading' });
  const [links, setLinks] = useState<DataExportLinks | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const loadSummary = useCallback(async () => {
    setSummaryState({ kind: 'loading' });
    try {
      const summary = await getDataExportSummary(request);
      if (isMounted.current) {
        setSummaryState({ kind: 'ready', summary });
      }
    } catch (caughtError) {
      if (isMounted.current) {
        setSummaryState(caughtError instanceof ApiError && caughtError.kind === 'notFound' ? { kind: 'unavailable' } : { kind: 'failed', cause: caughtError });
      }
    }
  }, [request]);

  useEffect(() => {
    loadSummary().catch(() => undefined);
  }, [loadSummary]);

  const createLinks = useCallback(async () => {
    try {
      const created = await createDataExportLinks(request);
      if (isMounted.current) {
        setLinks(created);
        setNeedsSignIn(false);
      }
      return true;
    } catch (caughtError) {
      if (!isMounted.current) {
        return true;
      }
      if (caughtError instanceof ApiError && caughtError.status === 403 && caughtError.code === 'recentAuthenticationRequired') {
        setNeedsSignIn(true);
        return false;
      }
      if (caughtError instanceof ApiError && caughtError.status === 429) {
        setNotice(t('dataExport.rateLimited'));
      } else if (caughtError instanceof ApiError && caughtError.kind === 'notFound') {
        setNotice(t('dataExport.unavailable'));
      } else {
        setNotice(t('dataExport.failed'));
      }
      return true;
    }
  }, [request, t]);

  const prepare = async () => {
    if (isBusy) {
      return;
    }
    setIsBusy(true);
    setNotice(null);
    setLinks(null);
    try {
      await createLinks();
    } finally {
      if (isMounted.current) {
        setIsBusy(false);
      }
    }
  };

  // The export holds every memo and locked Collection: the server asks for a sign-in that just happened (the same bar as resetting the
  // Collection lock password). The new tokens must be the same account; then the links are asked for once more.
  const signInAgain = async () => {
    if (isBusy) {
      return;
    }
    setIsBusy(true);
    setNotice(null);
    try {
      const outcome = await reauthenticateSameAccount();
      if (outcome !== 'reauthenticated') {
        if (isMounted.current) {
          setNotice(t(outcome === 'differentAccount' ? 'settings.collectionLockDifferentAccount' : 'settings.collectionLockSignInCancelled'));
        }
        return;
      }
      const done = await createLinks();
      if (!done && isMounted.current) {
        setNotice(t('dataExport.failed'));
      }
    } finally {
      if (isMounted.current) {
        setIsBusy(false);
      }
    }
  };

  const open = async (file: DataExportFileLink) => {
    const url = downloadUrl(file.downloadPath);
    if (!url) {
      setNotice(t('dataExport.openFailed'));
      return;
    }
    try {
      await Linking.openURL(url);
    } catch {
      if (isMounted.current) {
        setNotice(t('dataExport.openFailed'));
      }
    }
  };

  const number = (value: number) => new Intl.NumberFormat(i18n.language).format(value);
  const expiresAt = links?.expiresAtUtc ? new Intl.DateTimeFormat(i18n.language, { timeStyle: 'short' }).format(new Date(links.expiresAtUtc)) : null;

  if (summaryState.kind === 'loading') {
    return (
      <StackScreenSafeArea style={styles.safeArea}>
        <ActivityIndicator accessibilityLabel={t('dataExport.loading')} color={colors.textSecondary} style={styles.loader} testID="data-export-loading" />
      </StackScreenSafeArea>
    );
  }

  if (summaryState.kind === 'failed') {
    return (
      <StackScreenSafeArea style={styles.safeArea}>
        <LoadFailureState error={summaryState.cause} onRetry={() => { loadSummary().catch(() => undefined); }} testID="data-export-load-error" />
      </StackScreenSafeArea>
    );
  }

  if (summaryState.kind === 'unavailable') {
    return (
      <StackScreenSafeArea style={styles.safeArea}>
        <Text style={styles.standaloneNotice} testID="data-export-unavailable">{t('dataExport.unavailable')}</Text>
      </StackScreenSafeArea>
    );
  }

  const { summary } = summaryState;
  const rows: { readonly id: string; readonly label: string; readonly value: string }[] = [
    { id: 'links', label: t('dataExport.rowLinks'), value: number(summary.links) },
    { id: 'trash', label: t('dataExport.rowTrash'), value: number(summary.linksInTrash) },
    { id: 'collections', label: t('dataExport.rowCollections'), value: number(summary.ownedCollections) },
    { id: 'shared', label: t('dataExport.rowShared'), value: number(summary.sharedCollectionsJoined) },
    { id: 'comments', label: t('dataExport.rowComments'), value: number(summary.comments) },
    { id: 'photos', label: t('dataExport.rowPhotos'), value: number(summary.photos) },
    { id: 'photoSize', label: t('dataExport.rowPhotoSize'), value: t('dataExport.megabytes', { size: formatMegabytes(summary.photoBytes, i18n.language) }) },
  ];

  return (
    <StackScreenSafeArea style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>{t('dataExport.intro')}</Text>

        <Text accessibilityRole="header" style={styles.sectionTitle}>{t('dataExport.summaryHeading')}</Text>
        <View style={styles.card} testID="data-export-summary">
          {rows.map((row, index) => (
            <View key={row.id} style={[styles.row, index > 0 && styles.rowDivider]} testID={`data-export-row-${row.id}`}>
              <Text style={styles.rowLabel}>{row.label}</Text>
              <Text style={styles.rowValue}>{row.value}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.note}>{t('dataExport.includedNote')}</Text>

        {links ? (
          <>
            <Text accessibilityRole="header" style={styles.sectionTitle}>{t('dataExport.filesHeading')}</Text>
            <View style={styles.card} testID="data-export-files">
              {links.files.map((file, index) => (
                <View key={file.downloadPath} style={[styles.fileRow, index > 0 && styles.rowDivider]}>
                  <View style={styles.fileText}>
                    <Text style={styles.fileTitle}>{file.kind === 'data' ? t('dataExport.dataFile') : t('dataExport.photoFile', { number: file.number ?? index })}</Text>
                    {file.kind === 'photos' && file.photos !== null && file.bytes !== null ? (
                      <Text style={styles.fileDetail}>{t('dataExport.photoFileDetail', { count: file.photos, size: formatMegabytes(file.bytes, i18n.language) })}</Text>
                    ) : null}
                  </View>
                  <Pressable
                    accessibilityLabel={`${t('dataExport.download')} ${file.fileName}`}
                    accessibilityRole="button"
                    onPress={() => { open(file).catch(() => undefined); }}
                    style={styles.downloadButton}
                    testID={`data-export-download-${file.kind}-${file.number ?? 0}`}
                  >
                    <Text numberOfLines={1} style={styles.downloadLabel}>{t('dataExport.download')}</Text>
                  </Pressable>
                </View>
              ))}
            </View>
            {expiresAt ? <Text style={styles.note} testID="data-export-expiry">{t('dataExport.expiresNote', { time: expiresAt })}</Text> : null}
          </>
        ) : needsSignIn ? (
          <View style={[styles.card, styles.signInCard]} testID="data-export-reauth">
            <Text style={styles.fileTitle}>{t('dataExport.reauthTitle')}</Text>
            <Text style={styles.fileDetail}>{t('dataExport.reauthBody')}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: isBusy, busy: isBusy }}
              disabled={isBusy}
              onPress={() => { signInAgain().catch(() => undefined); }}
              style={[styles.primaryButton, isBusy && styles.disabledButton]}
              testID="data-export-reauth-action"
            >
              {isBusy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.primaryLabel}>{t('dataExport.reauthAction')}</Text>}
            </Pressable>
          </View>
        ) : null}
        {!needsSignIn ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: isBusy, busy: isBusy }}
            disabled={isBusy}
            onPress={() => { prepare().catch(() => undefined); }}
            style={[styles.primaryButton, isBusy && styles.disabledButton]}
            testID="data-export-create"
          >
            {isBusy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.primaryLabel}>{t('dataExport.create')}</Text>}
          </Pressable>
        ) : null}
        {notice ? <Text style={styles.notice} testID="data-export-notice">{notice}</Text> : null}
      </ScrollView>
    </StackScreenSafeArea>
  );
}

const styles = themedStyles(() => ({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { alignSelf: 'center', maxWidth: 640, padding: spacing.xl, paddingTop: spacing.lg, width: '100%' },
  loader: { marginTop: spacing.xl },
  intro: { color: colors.textPrimary, fontSize: 15, lineHeight: 22 },
  sectionTitle: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', marginBottom: spacing.sm, marginTop: spacing.xl },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, paddingHorizontal: spacing.md, ...cardShadow },
  signInCard: { marginTop: spacing.xl, paddingVertical: spacing.md, rowGap: spacing.xs },
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between', paddingVertical: spacing.md },
  rowDivider: { borderTopColor: colors.divider, borderTopWidth: StyleSheet.hairlineWidth },
  rowLabel: { color: colors.textSecondary, flexShrink: 1, fontSize: 14, lineHeight: 20 },
  rowValue: { color: colors.textPrimary, flexShrink: 0, fontSize: 14, fontWeight: '600', lineHeight: 20, textAlign: 'right' },
  note: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: spacing.sm },
  fileRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, minHeight: minTouchTarget, paddingVertical: spacing.md },
  fileText: { flex: 1, minWidth: 0 },
  fileTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  fileDetail: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 2 },
  downloadButton: { alignItems: 'center', borderColor: colors.brandText, borderRadius: radii.md, borderWidth: 1, flexShrink: 0, justifyContent: 'center', maxWidth: '45%', minHeight: minTouchTarget, paddingHorizontal: spacing.lg },
  downloadLabel: { color: colors.brandText, fontSize: 15, fontWeight: '600' },
  primaryButton: { alignItems: 'center', backgroundColor: colors.brand, borderRadius: radii.lg, justifyContent: 'center', marginTop: spacing.xl, minHeight: minTouchTarget, paddingHorizontal: spacing.md },
  primaryLabel: { color: colors.onBrand, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  disabledButton: { opacity: 0.5 },
  notice: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: spacing.md },
  standaloneNotice: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: spacing.xl, paddingHorizontal: spacing.xl },
}));
