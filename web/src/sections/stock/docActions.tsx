/* Кнопки документов склада в шапке и хозяин окон: приход, перемещение, списание, пересчёт. */
import { useCallback, useState, type ReactNode } from 'react';
import { ArrowLeftRight, ClipboardCheck, PackagePlus, Trash2 } from 'lucide-react';
import { useSession } from '../../roles/session';
import { Button, MoreMenu, type MenuItem } from '../../ui';
import { StockDocModal, type DocKind, type DocPreset } from './StockDocModal';
import { CountModal } from './CountModal';

type Open = { kind: DocKind; preset?: DocPreset } | { kind: 'count'; preset?: undefined };

export function useStockDocs() {
  const [state, setState] = useState<Open | null>(null);
  const open = useCallback((kind: DocKind | 'count', preset?: DocPreset) => setState(kind === 'count' ? { kind } : { kind, preset }), []);
  const close = useCallback(() => setState(null), []);
  const element: ReactNode = state ? (
    state.kind === 'count' ? <CountModal onClose={close} /> : <StockDocModal key={JSON.stringify(state)} kind={state.kind} preset={state.preset} onClose={close} />
  ) : null;
  return { open, element };
}

/** «Перемещение», «⋯» (Списание, Пересчёт), главная «Приход» — по правам роли. */
export function StockDocButtons({ open, extraMenu = [], primary = true }: { open: (kind: DocKind | 'count') => void; extraMenu?: MenuItem[]; primary?: boolean }) {
  const { can } = useSession();
  const menu: MenuItem[] = [
    { label: 'Списание', icon: <Trash2 />, onClick: () => open('writeoff'), hidden: !can('writeoff') },
    { label: 'Пересчёт', icon: <ClipboardCheck />, onClick: () => open('count'), hidden: !can('count') },
    ...extraMenu,
  ];
  return (
    <>
      {can('transfer') ? (
        <Button icon={<ArrowLeftRight />} onClick={() => open('transfer')}>
          Перемещение
        </Button>
      ) : null}
      <MoreMenu items={menu} />
      {can('income') ? (
        <Button variant={primary ? 'primary' : 'secondary'} icon={<PackagePlus />} onClick={() => open('income')}>
          Приход
        </Button>
      ) : null}
    </>
  );
}
