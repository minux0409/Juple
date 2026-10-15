/** The mounted Terms dialog answers a pending UGC write before it is sent. */
type Listener = (resolve: (accepted: boolean) => void, refresh: boolean) => void;

let listener: Listener | null = null;

export function onTermsAcceptanceRequired(next: Listener): () => void {
  listener = next;
  return () => {
    if (listener === next) {
      listener = null;
    }
  };
}

/** False when the user cancels or no interactive app screen is mounted. */
export function requestTermsAcceptance(refresh = false): Promise<boolean> {
  return new Promise(resolve => {
    if (!listener) {
      resolve(false);
      return;
    }
    listener(resolve, refresh);
  });
}
