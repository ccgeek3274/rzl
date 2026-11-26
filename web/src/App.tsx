import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { SeasonsPage } from './pages/Seasons';
import { SeasonLayout } from './pages/season/SeasonLayout';
import { TournamentsTab } from './pages/season/TournamentsTab';
import { IssuesTab } from './pages/season/IssuesTab';
import { IdentityTab } from './pages/season/IdentityTab';
import { StandingsTab } from './pages/season/StandingsTab';
import { PlayersTab } from './pages/season/PlayersTab';
import { ClubsTab } from './pages/season/ClubsTab';
import { SettingsTab } from './pages/season/SettingsTab';
import { TournamentPage } from './pages/season/TournamentPage';
import { LoadingBar } from './components/LoadingBar';
import { AuthButton } from './components/AuthButton';

export function App() {
  return (
    <>
      <LoadingBar />
      <header className="app-header">
        <Link to="/" className="app-brand">
          <span style={{ fontSize: 22 }}>♞</span> RŽL · evidence výsledků
        </Link>
        <AuthButton />
      </header>
      <main className="app-content">
        <Routes>
          <Route path="/" element={<SeasonsPage />} />
          <Route path="/s/:seasonId" element={<SeasonLayout />}>
            <Route index element={<Navigate to="turnaje" replace />} />
            <Route path="turnaje" element={<TournamentsTab />} />
            <Route path="turnaje/:tournamentId" element={<TournamentPage />} />
            <Route path="parovani" element={<IdentityTab />} />
            <Route path="kontrola" element={<IssuesTab />} />
            <Route path="poradi" element={<StandingsTab />} />
            <Route path="hraci" element={<PlayersTab />} />
            <Route path="oddily" element={<ClubsTab />} />
            <Route path="nastaveni" element={<SettingsTab />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}
