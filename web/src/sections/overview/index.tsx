import { lazy, Suspense } from 'react';
import { Route, Routes, Navigate } from 'react-router-dom';
import { useSession } from '../../roles/session';
import type { RoleKey } from '../../data/types';
import { SectionLoading } from '../../shell/SectionFrame';

/* У каждой роли свой рабочий стол. Файлы — у владельцев соответствующих разделов. */
const HOMES: Record<RoleKey, ReturnType<typeof lazy>> = {
  owner: lazy(() => import('./OwnerHome')),
  seller: lazy(() => import('../register/SellerHome')),
  manager: lazy(() => import('../sales/ManagerHome')),
  rep: lazy(() => import('../clients/RepHome')),
  accountant: lazy(() => import('../money/AccountantHome')),
  warehouse: lazy(() => import('../stock/WarehouseHome')),
  dispatcher: lazy(() => import('../delivery/DispatcherHome')),
  courier: lazy(() => import('../delivery/CourierHome')),
};
const Attention = lazy(() => import('./Attention'));

export default function OverviewSection() {
  const { role } = useSession();
  const Home = HOMES[role];
  return (
    <Suspense fallback={<SectionLoading />}>
      <Routes>
        <Route index element={<Home />} />
        <Route path="attention" element={role === 'owner' || role === 'accountant' ? <Attention /> : <Navigate to="/overview" replace />} />
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
    </Suspense>
  );
}
