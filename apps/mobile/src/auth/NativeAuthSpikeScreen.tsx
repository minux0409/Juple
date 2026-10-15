import { useState } from 'react';
import { Alert, NativeModules, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardSafeView } from '../components/KeyboardSafeView';

interface ProbeResult {
  readonly state: string;
  readonly bootstrapStatus?: number;
  readonly deleteStatus?: number;
  readonly apiErrorCode?: string | null;
  readonly audienceMatches?: boolean;
  readonly issuerMatches?: boolean;
  readonly scopeMatches?: boolean;
  readonly identityPresent?: boolean;
  readonly authTimePresent?: boolean;
  readonly oidGuid?: boolean;
  readonly tenantGuid?: boolean;
  readonly authTimeRecent?: boolean;
}

interface NativeAuthSpikeBridge {
  signIn(email: string, password: string): Promise<ProbeResult>;
  submitOtp(code: string): Promise<ProbeResult>;
  signUp(email: string, password: string): Promise<ProbeResult>;
  submitSignUpOtp(code: string): Promise<ProbeResult>;
  submitSignUpPassword(password: string): Promise<ProbeResult>;
  resetPassword(email: string): Promise<ProbeResult>;
  submitResetOtp(code: string): Promise<ProbeResult>;
  submitResetPassword(password: string): Promise<ProbeResult>;
  refresh(): Promise<ProbeResult>;
  signOut(): Promise<boolean>;
  deleteAccount(): Promise<ProbeResult>;
}

// The bridge is compiled only into Android dogfood. Never expose this developer UI in Play/release.
export const nativeAuthSpikeAvailable =
  process.env.JUPLE_API_ENV === 'dogfood' && Boolean(NativeModules.NativeAuthSpike);

declare const process: { readonly env: { readonly JUPLE_API_ENV?: string } };

export function NativeAuthSpikeScreen({ onClose }: { readonly onClose: () => void }) {
  const bridge = NativeModules.NativeAuthSpike as NativeAuthSpikeBridge;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [error, setError] = useState(false);

  const run = (action: () => Promise<ProbeResult>): void => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(false);
    Promise.resolve().then(action).then(setResult).catch(() => setError(true)).finally(() => setBusy(false));
  };

  return (
    <KeyboardSafeView>
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Native Auth DEV spike</Text>
      <Text style={styles.note}>DEV Entra only. No credentials or tokens are shown or logged.</Text>
      <TextInput autoCapitalize="none" autoComplete="email" keyboardType="email-address" onChangeText={setEmail} placeholder="Email" style={styles.input} value={email} />
      <TextInput autoComplete="password" onChangeText={setPassword} placeholder="Password" secureTextEntry style={styles.input} value={password} />
      <Pressable accessibilityRole="button" disabled={busy || !email || !password} onPress={() => {
        run(() => bridge.signIn(email, password));
        setPassword('');
      }} style={styles.button} testID="native-auth-spike-sign-in"><Text style={styles.buttonLabel}>Sign in with Native Auth</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy || !email || !password} onPress={() => {
        run(() => bridge.signUp(email, password));
        setPassword('');
      }} style={styles.button} testID="native-auth-spike-sign-up"><Text style={styles.buttonLabel}>Create DEV account</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy || !email} onPress={() => { run(() => bridge.resetPassword(email)); }} style={styles.button} testID="native-auth-spike-reset"><Text style={styles.buttonLabel}>Reset DEV password</Text></Pressable>
      {['codeRequired', 'signUpCodeRequired', 'resetCodeRequired'].includes(result?.state ?? '') ? (
        <View>
          <TextInput keyboardType="number-pad" onChangeText={setCode} placeholder="Email verification code" style={styles.input} value={code} />
          <Pressable accessibilityRole="button" disabled={busy || !code} onPress={() => {
            const submit = result?.state === 'signUpCodeRequired' ? bridge.submitSignUpOtp(code)
              : result?.state === 'resetCodeRequired' ? bridge.submitResetOtp(code) : bridge.submitOtp(code);
            run(() => submit);
            setCode('');
          }} style={styles.button} testID="native-auth-spike-otp"><Text style={styles.buttonLabel}>Verify code</Text></Pressable>
        </View>
      ) : null}
      {['signUpPasswordRequired', 'resetPasswordRequired'].includes(result?.state ?? '') ? (
        <Pressable accessibilityRole="button" disabled={busy || !password} onPress={() => {
          const submit = result?.state === 'signUpPasswordRequired' ? bridge.submitSignUpPassword(password) : bridge.submitResetPassword(password);
          run(() => submit);
          setPassword('');
        }} style={styles.button} testID="native-auth-spike-submit-password"><Text style={styles.buttonLabel}>Submit new password</Text></Pressable>
      ) : null}
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => { run(() => bridge.refresh()); }} style={styles.button}><Text style={styles.buttonLabel}>Refresh native session and API</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => { bridge.signOut().then(signedOut => signedOut ? setResult({ state: 'signedOut' }) : setError(true)).catch(() => setError(true)); }} style={styles.button}><Text style={styles.buttonLabel}>Sign out native session</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => {
        Alert.alert('Delete disposable DEV account?', 'Permanently deletes this account and its Juple data.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => { run(() => bridge.deleteAccount()); } },
        ]);
      }} style={styles.button}><Text style={styles.buttonLabel}>Delete disposable DEV account</Text></Pressable>
      {result ? <Text testID="native-auth-spike-result">{JSON.stringify(result)}</Text> : null}
      {error ? <Text>Native Auth probe failed. Check DEV registration and network.</Text> : null}
      <Pressable accessibilityRole="button" onPress={onClose} style={styles.back}><Text>Back to Juple login</Text></Pressable>
    </ScrollView>
    </KeyboardSafeView>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'stretch', gap: 12, justifyContent: 'center', minHeight: '100%', padding: 24 },
  title: { fontSize: 22, fontWeight: '700' },
  note: { color: '#555555', fontSize: 13 },
  input: { borderColor: '#888888', borderRadius: 8, borderWidth: 1, minHeight: 48, paddingHorizontal: 12 },
  button: { alignItems: 'center', backgroundColor: '#111111', borderRadius: 8, minHeight: 48, justifyContent: 'center', padding: 12 },
  buttonLabel: { color: '#FFFFFF', fontWeight: '600' },
  back: { alignItems: 'center', minHeight: 48, justifyContent: 'center' },
});
