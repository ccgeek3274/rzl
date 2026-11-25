import { api } from './api';

type Step = { processed: number; remaining: number; errors: string[]; since: number; clubsDone: string[] };

/**
 * Batch step for "Aktualizovat Ela": club by club, then the rest one by one. The server fixes `since` on the first
 * call; `since` and the clubs already read are passed back on each next call.
 */
export function eloRefreshStep(seasonId: number) {
  let since: number | undefined;
  let clubsDone: string[] = [];
  return async () => {
    const r = await api.post<Step>(`/seasons/${seasonId}/refresh-elo`, { since, clubsDone, limit: 10 });
    since = r.since;
    clubsDone = r.clubsDone;
    return r;
  };
}
