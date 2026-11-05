/* Раздел «Чаты» (WhatsApp магазина): отдельный пункт меню. Страница та же, что раньше была вкладкой «Продаж». */
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { SectionLoading } from '../../shell/SectionFrame';
import './sales.css';

const ChatsPage = lazy(() => import('./ChatsPage'));

export default function ChatsSection() {
  return (
    <Suspense fallback={<SectionLoading />}>
      <Routes>
        <Route index element={<ChatsPage />} />
        <Route path="*" element={<Navigate to="/chats" replace />} />
      </Routes>
    </Suspense>
  );
}
