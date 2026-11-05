/* Детали окон раздела «Деньги»: выбор покупателя, способ и счёт, таблица распределения. */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import type { AccountKey, Client, ID, ISODate, PayMethod } from '../../data/types';
import { ACCOUNT_NAMES, CLIENT_SEGMENT_NAMES, PAY_METHOD_NAMES } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { accountBalances, clientBalances, indexes } from '../../data/selectors';
import { Chip, EmptyState, Field, MoneyInput, SearchInput, Segmented, Select, StatusChip, cx, fmt, overdueStatus } from '../../ui';
import { ACCOUNT_KEYS, METHOD_KEYS, defaultAccount, type OpenOrder } from './lib';

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

/** Поиск покупателя: сначала с долгом. */
export function ClientPicker({ clients, onPick, autoFocus = true, placeholder = 'Найти покупателя: название, ИНН или телефон' }: { clients: Client[]; onPick: (id: ID) => void; autoFocus?: boolean; placeholder?: string }) {
  const db = useDB();
  const v = useDBVersion();
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const bal = clientBalances(db);
    const ix = indexes(db);
    const tokens = norm(q.trim()).split(/\s+/).filter(Boolean);
    return clients
      .filter((c) => {
        if (!tokens.length) return true;
        const t = norm(`${c.name} ${c.inn ?? ''} ${c.phone}`);
        return tokens.every((tok) => t.includes(tok));
      })
      .map((c) => ({ c, b: bal.get(c.id), owner: c.ownerId ? ix.employees.get(c.ownerId)?.short ?? '' : '' }))
      .sort((a, b) => (b.b?.debt ?? 0) - (a.b?.debt ?? 0) || a.c.name.localeCompare(b.c.name, 'ru'))
      .slice(0, 6);
  }, [db, v, clients, q]);
  return (
    <div className="col-3">
      <SearchInput value={q} onChange={setQ} placeholder={placeholder} autoFocus={autoFocus} />
      <div className="money-pick">
        {list.length ? (
          list.map(({ c, b, owner }) => (
            <button key={c.id} type="button" className="list-row money-pick-row" onClick={() => onPick(c.id)}>
              <span className="grow">
                <span className="w-600 ellipsis" style={{ display: 'block' }}>
                  {c.name}
                </span>
                <span className="t-12 muted">
                  {CLIENT_SEGMENT_NAMES[c.segment]}
                  {owner ? ` · ${owner}` : ''}
                </span>
              </span>
              {b && b.maxOverdueDays > 0 ? <StatusChip s={overdueStatus(b.maxOverdueDays)} /> : null}
              <span className="num w-600" style={{ minWidth: 96, textAlign: 'right' }}>
                {b && b.debt > 0 ? fmt.money(b.debt) : <span className="faint">Без долга</span>}
              </span>
            </button>
          ))
        ) : (
          <EmptyState title="Никого не нашли">Проверьте название или ИНН</EmptyState>
        )}
      </div>
    </div>
  );
}

/** Строка выбранного покупателя: долг, просрочено, аванс. */
export function ClientSummary({ clientId, onChange }: { clientId: ID; onChange?: () => void }) {
  const db = useDB();
  const v = useDBVersion();
  const info = useMemo(() => {
    const c = indexes(db).clients.get(clientId);
    const b = clientBalances(db).get(clientId);
    const owner = c?.ownerId ? indexes(db).employees.get(c.ownerId)?.short : null;
    return { c, b, owner };
  }, [db, v, clientId]);
  if (!info.c) return null;
  const { c, b, owner } = info;
  return (
    <div className="money-client">
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 10 }}>
          <span className="t-16 w-700 ellipsis">{c.name}</span>
          {onChange ? (
            <button type="button" className="link-button t-12" onClick={onChange}>
              Другой покупатель
            </button>
          ) : null}
        </div>
        <div className="t-12 muted">
          {CLIENT_SEGMENT_NAMES[c.segment]}
          {c.deferDays > 0 ? ` · отсрочка ${c.deferDays} дн.` : ' · без отсрочки'}
          {owner ? ` · ${owner}` : ''}
        </div>
      </div>
      <MiniStat label="Долг" value={fmt.money(b?.debt ?? 0)} />
      <MiniStat
        label="Просрочено"
        value={<span className={b && b.overdue > 0 ? 'c-bad' : undefined}>{fmt.money(b?.overdue ?? 0)}</span>}
        extra={b && b.maxOverdueDays > 0 ? <StatusChip s={overdueStatus(b.maxOverdueDays)} /> : null}
      />
      {b && b.pending > 0 ? <MiniStat label="Ждёт подтверждения" value={fmt.money(b.pending)} /> : null}
      {b && b.advance > 0 ? <MiniStat label="Аванс" value={fmt.money(b.advance)} /> : null}
    </div>
  );
}

export function MiniStat({ label, value, extra }: { label: ReactNode; value: ReactNode; extra?: ReactNode }) {
  return (
    <div className="money-mini">
      <span className="t-12 muted">{label}</span>
      <span className="row" style={{ gap: 6 }}>
        <span className="t-16 w-700 num">{value}</span>
        {extra}
      </span>
    </div>
  );
}

/** Способ оплаты таблетками. */
export function MethodField({ value, onChange, label = 'Способ' }: { value: PayMethod; onChange: (m: PayMethod) => void; label?: string }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <Segmented<PayMethod> value={value} onChange={onChange} options={METHOD_KEYS.map((m) => ({ value: m, label: PAY_METHOD_NAMES[m] }))} ariaLabel="Способ оплаты" />
    </div>
  );
}

/** Касса или счёт с остатком в подписи. */
export function AccountField({ value, onChange, label = 'Касса или счёт', exclude, showBalance = true }: { value: AccountKey; onChange: (a: AccountKey) => void; label?: string; exclude?: AccountKey; showBalance?: boolean }) {
  const db = useDB();
  const v = useDBVersion();
  const bal = useMemo(() => accountBalances(db), [db, v]);
  return (
    <Field label={label}>
      <Select
        value={value}
        onChange={(e) => onChange(e.target.value as AccountKey)}
        options={ACCOUNT_KEYS.filter((a) => a !== exclude).map((a) => ({ value: a, label: showBalance ? `${ACCOUNT_NAMES[a]} · ${fmt.money(bal[a])}` : ACCOUNT_NAMES[a] }))}
      />
    </Field>
  );
}

/** Связка «способ → касса» с подстановкой по способу. */
export function useMethodAccount(initial: PayMethod = 'transfer') {
  const [method, setMethodRaw] = useState<PayMethod>(initial);
  const [account, setAccount] = useState<AccountKey>(defaultAccount(initial));
  const setMethod = (m: PayMethod) => {
    setMethodRaw(m);
    setAccount(defaultAccount(m));
  };
  return { method, setMethod, account, setAccount };
}

/** Таблица «к оплате — разнести» по заказам клиента. */
export function AllocationTable({
  rows,
  values,
  onChange,
  amount,
  today,
  emptyText = 'Неоплаченных заказов нет — вся сумма станет авансом клиента',
  onReset,
  manual,
}: {
  rows: OpenOrder[];
  values: Record<ID, number>;
  onChange: (orderId: ID, v: number) => void;
  amount: number;
  today: ISODate;
  emptyText?: string;
  onReset?: () => void;
  manual?: boolean;
}) {
  const allocated = rows.reduce((s, r) => s + (values[r.order.id] ?? 0), 0);
  const left = amount - allocated;
  return (
    <div className="money-alloc">
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="t-14 w-700 grow">Распределение по заказам</span>
        {onReset && manual ? (
          <button type="button" className="link-button t-12" onClick={onReset}>
            Распределить по порядку: старые долги первыми
          </button>
        ) : rows.length ? (
          <span className="t-12 muted">Старые долги первыми · можно поправить</span>
        ) : null}
      </div>
      {rows.length ? (
        <div className="money-alloc-box">
          <table className="table table-dense">
            <thead>
              <tr>
                <th>Заказ</th>
                <th>Срок оплаты</th>
                <th className="num">К оплате</th>
                <th className="num" style={{ width: 150 }}>
                  Разнести
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const v = values[r.order.id] ?? 0;
                // просрочка — из расчёта заказа: у заказа с неудачной доставкой её нет
                const overdue = r.debtFree > 0 ? r.op.overdueDays : 0;
                return (
                  <tr key={r.order.id} className={cx(v > 0 && 'money-alloc-on')}>
                    <td>
                      <span className="w-600">№ {r.order.number}</span>
                      <span className="muted t-12"> · от {fmt.date(r.order.createdAt)}</span>
                      {r.debtFree === 0 ? <span className="muted t-12"> · предоплата</span> : null}
                    </td>
                    <td>
                      <span className="row" style={{ gap: 6 }}>
                        <span>{r.order.dueDate ? fmt.date(r.order.dueDate) : 'после отгрузки'}</span>
                        {overdue > 0 ? <StatusChip s={overdueStatus(overdue)} /> : null}
                      </span>
                    </td>
                    <td className="num">{fmt.money(r.free)}</td>
                    <td className="num">
                      <div className="money-alloc-input">
                        <MoneyInput size="sm" value={v || ''} placeholder="0" onChange={(x) => onChange(r.order.id, Math.min(Number(x || 0), r.free))} />
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon btn-sm"
                          title="Разнести полностью"
                          aria-label={`Разнести на заказ № ${r.order.number} полностью`}
                          onClick={() => onChange(r.order.id, v >= r.free ? 0 : r.free)}
                        >
                          <Check />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Итого</td>
                <td className="num">{fmt.money(rows.reduce((s, r) => s + r.free, 0))}</td>
                <td className="num">{fmt.money(allocated)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div className="money-alloc-box">
          <EmptyState title="Нечего распределять">{emptyText}</EmptyState>
        </div>
      )}
      {amount > 0 && left > 0 ? (
        <div className="money-alloc-left">
          <Chip tone="info">Аванс {fmt.money(left)}</Chip>
          <span className="t-13 ink-2">Остаток не разнесён на заказы и станет авансом клиента</span>
        </div>
      ) : null}
      {left < 0 ? (
        <div className="money-alloc-left">
          <Chip tone="bad">Лишние {fmt.money(-left)}</Chip>
          <span className="t-13 c-bad">Распределено больше суммы оплаты — уменьшите строки</span>
        </div>
      ) : null}
    </div>
  );
}

/** Ввод даты (не позже сегодня). */
export function DateField({ value, onChange, min, max, label = 'Дата' }: { value: ISODate; onChange: (v: ISODate) => void; min?: ISODate; max?: ISODate; label?: string }) {
  return (
    <Field label={label}>
      <input className="input" type="date" value={value} min={min} max={max} onChange={(e) => e.target.value && onChange(e.target.value)} />
    </Field>
  );
}

/** Строка списка в карточке: слева метка, в середине две строки (вторая — с чипами), справа сумма и действие. */
export function MoneyLi({ lead, title, sub, amount, badge, action, onClick }: { lead?: ReactNode; title: ReactNode; sub?: ReactNode; amount?: ReactNode; badge?: ReactNode; action?: ReactNode; onClick?: () => void }) {
  const body = (
    <>
      {lead ? <span className="money-li-lead">{lead}</span> : null}
      <span className="money-li-main">
        <span className="money-li-title">{title}</span>
        {sub ? <span className="money-li-sub">{typeof sub === 'string' ? <span>{sub}</span> : sub}</span> : null}
      </span>
      {amount !== undefined ? (
        <span className="money-li-amt num">
          <span>{amount}</span>
          {badge}
        </span>
      ) : null}
      {action ? (
        <span className="money-li-act" onClick={(e) => e.stopPropagation()}>
          {action}
        </span>
      ) : null}
    </>
  );
  if (onClick)
    return (
      <div role="button" tabIndex={0} className="list-row money-li is-click" onClick={onClick} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick())}>
        {body}
      </div>
    );
  return <div className="list-row money-li">{body}</div>;
}

/** Показатель, который открывает экран. Kpi из набора с onClick получает прозрачный фон — оборачиваем сами. */
export function KpiLink({ onClick, children, label }: { onClick: () => void; children: ReactNode; label: string }) {
  return (
    <button type="button" className="money-kpi-link" onClick={onClick} aria-label={label}>
      {children}
    </button>
  );
}

/** Узкий экран (1280 и уже): прячем второстепенные колонки. */
export function useNarrow(): boolean {
  return useNarrowQuery('(max-width: 1360px)');
}

/** Телефон (до 760 px): таблицы заменяем карточками. */
export function usePhone(): boolean {
  return useNarrowQuery('(max-width: 760px)');
}

function useNarrowQuery(q: string): boolean {
  const [n, setN] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const h = () => setN(m.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, [q]);
  return n;
}

/** Сводка на телефоне: две колонки «подпись — число» в одной карточке вместо четырёх больших. */
export function PhoneStats({ items }: { items: { label: ReactNode; value: ReactNode }[] }) {
  return (
    <div className="card money-phone-stats">
      {items.map((x, i) => (
        <div key={i} className="money-phone-stat">
          <span className="money-phone-stat-label">{x.label}</span>
          <span className="money-phone-stat-value num">{x.value}</span>
        </div>
      ))}
    </div>
  );
}
