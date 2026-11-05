import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from '../../roles/session';
import { ClientsPage } from './ClientsPage';
import { RepsPage } from './RepsPage';
import './clients.css';

/** Раздел «Клиенты»: список клиентов и вкладка «Представители и визиты». */
export default function Section() {
  const { role } = useSession();
  const seesReps = role === 'owner' || role === 'manager' || role === 'rep';
  return (
    <Routes>
      <Route index element={<ClientsPage />} />
      <Route path="reps" element={seesReps ? <RepsPage /> : <Navigate to="/clients" replace />} />
      <Route path="*" element={<Navigate to="/clients" replace />} />
    </Routes>
  );
}
