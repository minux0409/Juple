import { useAuth } from './AuthContext';

/** True once the backend-reported plan (see bootstrap's response) is confirmed Plus - false while unknown (not yet bootstrapped) or confirmed Free, never guessed. */
export function useIsPlusUser(): boolean {
  return useAuth().plan === 'Plus';
}
