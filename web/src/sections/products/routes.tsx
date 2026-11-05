import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from '../../roles/session';
import { useIsPhone } from './lib';
import Catalog from './Catalog';
import PhoneCatalog from './PhoneCatalog';
import Pricing from './Pricing';
import './products.css';

/** Раздел «Товары»: каталог (на телефоне — карточками) и «Цены и акции». Маршруты относительно /products. */
export default function Section() {
  const { role } = useSession();
  const phone = useIsPhone();
  const pricingAllowed = role === 'owner' || role === 'manager' || role === 'accountant';
  return (
    <Routes>
      <Route index element={phone ? <PhoneCatalog /> : <Catalog />} />
      <Route path="pricing" element={pricingAllowed ? <Pricing /> : <Navigate to="/products" replace />} />
      <Route path="*" element={<Navigate to="/products" replace />} />
    </Routes>
  );
}
