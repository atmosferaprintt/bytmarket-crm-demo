import { Navigate, Route, Routes } from 'react-router-dom';
import './settings.css';
import { CompanyPage } from './CompanyPage';
import { TeamPage } from './team/TeamPage';
import { SetupPage } from './setup/SetupPage';
import { IntegrationsPage } from './IntegrationsPage';

/** Раздел «Настройки» (только владелец): компания, команда и права, подготовка к работе, подключения. */
export default function Section() {
  return (
    <Routes>
      <Route index element={<CompanyPage />} />
      <Route path="team" element={<TeamPage />} />
      <Route path="setup" element={<SetupPage />} />
      <Route path="integrations" element={<IntegrationsPage />} />
      <Route path="*" element={<Navigate to="/settings" replace />} />
    </Routes>
  );
}
