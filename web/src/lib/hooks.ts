import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { useSearchParams } from 'react-router-dom';
import type { ClubDto, InstanceDto, Issue, PlayerDetailDto, SeasonDto, SeasonPlayerDto, StandingDto, SeasonSummary, TournamentDetailDto, HistoryDto } from '../../../shared/types';
import type { RoundDto } from '../../../shared/types';
import { api, ApiError, apiErrorText } from './api';

export const useSeasons = () => useQuery({ queryKey: ['seasons'], queryFn: () => api.get<SeasonSummary[]>('/seasons') });
export const useSeason = (id: number) => useQuery({ queryKey: ['season', id], queryFn: () => api.get<SeasonDto>(`/seasons/${id}`) });
export const useStandings = (id: number) =>
  useQuery({ queryKey: ['season', id, 'standings'], queryFn: () => api.get<{ rounds: RoundDto[]; bestN: number; rows: StandingDto[] }>(`/seasons/${id}/standings`) });
export const useHistory = (id: number) => useQuery({ queryKey: ['season', id, 'history'], queryFn: () => api.get<HistoryDto[]>(`/seasons/${id}/history`) });
export const useIssues = (id: number) => useQuery({ queryKey: ['season', id, 'issues'], queryFn: () => api.get<Issue[]>(`/seasons/${id}/issues`) });
export const useSeasonPlayers = (id: number) => useQuery({ queryKey: ['season', id, 'players'], queryFn: () => api.get<SeasonPlayerDto[]>(`/seasons/${id}/players`) });
export const useClubs = (seasonId?: number) => useQuery({ queryKey: ['clubs', seasonId ?? 0], queryFn: () => api.get<ClubDto[]>(`/clubs${seasonId ? `?season=${seasonId}` : ''}`) });
export const useInstances = (id: number) => useQuery({ queryKey: ['season', id, 'instances'], queryFn: () => api.get<InstanceDto[]>(`/seasons/${id}/instances`) });
export const useTournament = (id: number) => useQuery({ queryKey: ['tournament', id], queryFn: () => api.get<TournamentDetailDto>(`/tournaments/${id}`) });
export const usePlayer = (id: number | null, seasonId?: number) =>
  useQuery({ queryKey: ['player', id, seasonId ?? 0], queryFn: () => api.get<PlayerDetailDto>(`/players/${id}${seasonId ? `?season=${seasonId}` : ''}`), enabled: id != null });

/** Any data change can move standings, issues, players… — refresh everything derived. */
export function useInvalidateAll() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['season'] });
    qc.invalidateQueries({ queryKey: ['tournament'] });
    qc.invalidateQueries({ queryKey: ['player'] });
    qc.invalidateQueries({ queryKey: ['clubs'] });
    qc.invalidateQueries({ queryKey: ['seasons'] });
  };
}

/** Mutation with error toast + global invalidation. */
export function useAction<TVars, TRes = unknown>(fn: (v: TVars) => Promise<TRes>, successText?: string | ((r: TRes) => string)) {
  const { message } = App.useApp();
  const invalidate = useInvalidateAll();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      invalidate();
      if (successText) message.success(typeof successText === 'function' ? successText(r) : successText);
    },
    onError: (e) => {
      message.error(apiErrorText(e) ?? 'Chyba');
      // Session expired / logged out elsewhere: switch the UI to browsing.
      if (e instanceof ApiError && e.status === 401) qc.invalidateQueries({ queryKey: ['auth'] });
    },
  });
}

/** The player drawer is opened via ?hrac=ID so it works from every page and survives reloads. */
export function usePlayerDrawer() {
  const [sp, setSp] = useSearchParams();
  const id = sp.get('hrac') ? Number(sp.get('hrac')) : null;
  return {
    id,
    open: (pid: number) => {
      const n = new URLSearchParams(sp);
      n.set('hrac', String(pid));
      setSp(n);
    },
    close: () => {
      const n = new URLSearchParams(sp);
      n.delete('hrac');
      setSp(n);
    },
  };
}

export const crUrl = (tnr: number, art = 1) => `https://chess-results.com/tnr${tnr}.aspx?lan=5&art=${art}&turdet=YES`;

/** Operator mode (logged in with the shared password); otherwise the app is read-only. */
export const useAuth = () => useQuery({ queryKey: ['auth'], queryFn: () => api.get<{ admin: boolean }>('/auth/me'), staleTime: 5 * 60_000 });
export const useIsAdmin = () => useAuth().data?.admin ?? false;
