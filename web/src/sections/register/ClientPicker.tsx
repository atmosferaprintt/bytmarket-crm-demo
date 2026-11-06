/* Покупатель по карте постоянного клиента: номер карты, телефон или имя. */
import { useMemo, useState } from 'react';
import { CreditCard, UserRound } from 'lucide-react';
import type { Client, ID } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { useScoped } from '../../roles/scope';
import { Button, EmptyState, Modal, SearchInput, cx, fmt } from '../../ui';
import { cardNumber, norm } from './lib';

export function ClientPicker({ current, onPick, onClose }: { current: ID | null; onPick: (id: ID | null) => void; onClose: () => void }) {
  const db = useDB();
  const version = useDBVersion();
  const { clients } = useScoped();
  const [q, setQ] = useState('');
  const [hl, setHl] = useState(0);

  const all = useMemo(
    () =>
      clients
        .filter((c) => c.active && c.segment === 'retail')
        .map((c) => ({ c, card: cardNumber(db, c), text: norm(`${c.name} ${c.phone.replace(/\D/g, '')} ${cardNumber(db, c)}`) })),
    [clients, db, version],
  );
  const list = useMemo(() => {
    const t = norm(q.trim());
    if (!t) return all.slice(0, 8);
    // телефон можно вводить с пробелами, скобками и восьмёркой в начале
    const digits = t.replace(/\D/g, '');
    const phoneLike = /^[\d\s()+-]+$/.test(t);
    const tokens = phoneLike ? [digits.replace(/^8(\d{10})$/, '7$1')] : t.split(/\s+/).filter(Boolean);
    return all.filter((x) => tokens.every((k) => x.text.includes(k))).slice(0, 8);
  }, [all, q]);

  const pick = (c: Client) => {
    onPick(c.id);
    onClose();
  };

  return (
    <Modal
      title="Покупатель"
      sub="Карта постоянного покупателя: отсканируйте или найдите по телефону"
      onClose={onClose}
      footer={
        <>
          {current ? (
            <Button
              variant="ghost"
              onClick={() => {
                onPick(null);
                onClose();
              }}
            >
              Продать без карты
            </Button>
          ) : null}
          <span className="spacer" />
          <Button variant="secondary" onClick={onClose}>
            Закрыть
          </Button>
        </>
      }
    >
      <div data-hint="register.picker-search">
        <SearchInput
          value={q}
          onChange={(v) => {
            setQ(v);
            setHl(0);
          }}
          placeholder="Номер карты, телефон или имя"
          size="lg"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHl((h) => Math.min(list.length - 1, h + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHl((h) => Math.max(0, h - 1));
            } else if (e.key === 'Enter' && list[hl]) {
              e.preventDefault();
              pick(list[hl].c);
            }
          }}
        />
      </div>
      {list.length ? (
        <div className="reg-picker" data-hint="register.picker-list">
          {list.map((x, i) => (
            <button key={x.c.id} type="button" className={cx('reg-picker-row', i === hl && 'is-hl', x.c.id === current && 'is-current')} onClick={() => pick(x.c)} onMouseEnter={() => setHl(i)}>
              <span className="icon-tile">
                <UserRound />
              </span>
              <span className="grow">
                <span className="w-600 ellipsis" style={{ display: 'block' }}>
                  {x.c.name}
                </span>
                <span className="t-12 muted row" style={{ gap: 6 }}>
                  <CreditCard size={12} />
                  {x.card} · {fmt.phone(x.c.phone)}
                </span>
              </span>
              {i === hl ? <span className="kbd">Enter</span> : null}
            </button>
          ))}
        </div>
      ) : (
        <EmptyState title="Никого не нашли">Проверьте номер карты или телефон. Продать можно и без карты.</EmptyState>
      )}
    </Modal>
  );
}
