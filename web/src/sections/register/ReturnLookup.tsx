/* «Возврат»: найти чек продажи по номеру и открыть возврат в его карточке. */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ReceiptText } from 'lucide-react';
import type { Receipt } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { useScoped } from '../../roles/scope';
import { Button, Chip, EmptyState, Modal, Notice, SearchInput, cx, fmt } from '../../ui';
import { PAY_KIND_NAMES, payKind, receiptContents } from './lib';

export function useOpenRefund() {
  const [params, setParams] = useSearchParams();
  return (r: Receipt) => {
    const next = new URLSearchParams(params);
    next.set('open', `receipt:${r.id}`);
    next.set('refund', '1');
    setParams(next);
  };
}

export function ReturnLookup({ onClose }: { onClose: () => void }) {
  const db = useDB();
  const version = useDBVersion();
  const { receipts } = useScoped();
  const openRefund = useOpenRefund();
  const [q, setQ] = useState('');
  const [hl, setHl] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recent = useMemo(() => {
    const out: Receipt[] = [];
    for (let i = receipts.length - 1; i >= 0 && out.length < 6; i--) if (receipts[i].kind === 'sale') out.push(receipts[i]);
    return out;
  }, [receipts, version]);

  const list = useMemo(() => {
    const t = q.replace(/\D/g, '');
    if (!t) return recent;
    const out: Receipt[] = [];
    for (let i = receipts.length - 1; i >= 0 && out.length < 6; i--) {
      const r = receipts[i];
      if (r.kind === 'sale' && String(r.number).startsWith(t)) out.push(r);
    }
    return out;
  }, [q, receipts, recent]);

  const go = (r: Receipt | undefined) => {
    if (!r) {
      setError(`Чек № ${q.replace(/\D/g, '')} не найден. Проверьте номер на чеке покупателя.`);
      return;
    }
    onClose();
    openRefund(r);
  };

  return (
    <Modal
      title="Возврат по чеку"
      sub="Введите номер с чека покупателя или выберите из последних"
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Закрыть
        </Button>
      }
    >
      <div data-hint="register.lookup-search">
        <SearchInput
          value={q}
          onChange={(v) => {
            setQ(v);
            setHl(0);
            setError(null);
          }}
          placeholder="Номер чека"
          size="lg"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHl((h) => Math.min(list.length - 1, h + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHl((h) => Math.max(0, h - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const exact = receipts.find((r) => r.kind === 'sale' && String(r.number) === q.replace(/\D/g, ''));
              go(exact ?? list[hl]);
            }
          }}
        />
      </div>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {list.length ? (
        <div className="reg-picker" data-hint="register.lookup-list">
          {list.map((r, i) => (
            <button key={r.id} type="button" className={cx('reg-picker-row', i === hl && 'is-hl')} onClick={() => go(r)} onMouseEnter={() => setHl(i)}>
              <span className="icon-tile">
                <ReceiptText />
              </span>
              <span className="grow">
                <span className="w-600" style={{ display: 'block' }}>
                  Чек № {r.number} · {fmt.dateTime(r.at)}
                </span>
                <span className="t-12 muted ellipsis" style={{ display: 'block' }}>
                  {receiptContents(db, r)}
                </span>
              </span>
              <Chip>{PAY_KIND_NAMES[payKind(r)]}</Chip>
              <span className="w-700 num">{fmt.money(r.total)}</span>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState title="Чеков с таким номером нет" />
      )}
    </Modal>
  );
}
