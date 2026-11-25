import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export interface PublicConfig {
  demoMode: boolean;
  paymentDetails: { instapay: string; ewallet: string };
  maxUploadBytes: number;
  maxMediaBytes: number;
}

/** Public, non-sensitive settings. Admin credentials are never sent to the browser. */
export function usePublicConfig() {
  return useQuery({
    queryKey: ['public-config'],
    queryFn: () => api.get<PublicConfig>('/api/auth/config'),
    staleTime: 5 * 60 * 1000,
  });
}
