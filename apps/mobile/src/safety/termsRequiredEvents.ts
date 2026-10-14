/**
 * A content write the server refused for the missing Terms agreement (403 termsAcceptanceRequired) asks the app to show the
 * agreement again - from anywhere, with no screen having to know about it. A tiny listener list; nothing is stored.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function onTermsAcceptanceRequired(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyTermsAcceptanceRequired(): void {
  listeners.forEach(listener => listener());
}
