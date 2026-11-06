/* Склад → Карантин: товар на проверке и история решений. В продажу — только после проверки. */
import { useMemo, useState } from 'react';
import { RotateCcw, ShieldCheck, Trash2, Undo2 } from 'lucide-react';
import type { DB, QuarantineItem, WriteoffReason } from '../../data/types';
import { LOCATION_NAMES, WRITEOFF_REASONS } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { indexes } from '../../data/selectors';
import { get } from '../../data/idx';
import { useSession } from '../../roles/session';
import { PageHeader } from '../../shell/PageHeader';
import { EntityLink, useOpenEntity } from '../../shell/entities';
import { Button, Card, DataTable, EmptyState, Field, Input, Modal, Notice, Select, StatList, StatRow, StatusChip, QUARANTINE_STATE, fmt, toast, type Column, type FilterDef, type StatusDef } from '../../ui';
import { shortName } from './calc';
import { stockTabCounts } from './picking';
import { act } from './act';
import { quarantineCanRelease } from '../../data/ops';
import { shortWhen } from './useNarrow';

export const Q_SOURCE: Record<QuarantineItem['source'], string> = {
  return: 'Возврат покупателя',
  delivery_failed: 'Не доставлен',
  purchase_defect: 'Брак при приёмке',
};

/** Причина без повтора источника: «Не доставлен: Отказ от товара» → «Отказ от товара» */
export function qReason(q: QuarantineItem): string {
  return q.reason.replace(/^Не доставлен:\s*/i, '').replace(/^Брак при приёмке:\s*/i, '');
}

export function QSourceLink({ db, q }: { db: DB; q: QuarantineItem }) {
  if (q.source === 'purchase_defect') {
    const pu = get(db, 'purchases', q.sourceId);
    return pu ? <EntityLink type="purchase" id={pu.id}>Закупка № {pu.number}</EntityLink> : null;
  }
  if (q.source === 'delivery_failed') {
    const d = get(db, 'deliveries', q.sourceId);
    return d ? <EntityLink type="delivery" id={d.id}>Доставка № {d.number}</EntityLink> : null;
  }
  const r = get(db, 'returns', q.sourceId);
  if (!r) return null;
  if (r.orderId) return <EntityLink type="order" id={r.orderId}>Возврат № {r.number}</EntityLink>;
  if (r.receiptId) return <EntityLink type="receipt" id={r.receiptId}>Возврат № {r.number}</EntityLink>;
  return <span>Возврат № {r.number}</span>;
}

function sourceDoc(db: DB, q: QuarantineItem): string {
  if (q.source === 'purchase_defect') return `Закупка № ${get(db, 'purchases', q.sourceId)?.number ?? ''}`;
  if (q.source === 'delivery_failed') return `Доставка № ${get(db, 'deliveries', q.sourceId)?.number ?? ''}`;
  return `Возврат № ${get(db, 'returns', q.sourceId)?.number ?? ''}`;
}

type Decision = 'release' | 'writeoff' | 'supplier';

/** Бухгалтер, которому уходит задача учесть возврат поставщику. */
function accountantOf(db: DB) {
  const list = db.employees.filter((e) => e.active && e.roles.includes('accountant'));
  return list.find((e) => e.id === 'e-suleymanova') ?? list[0];
}

/** Решение по товару на проверке — с подтверждением: вернуть в продажу, списать, вернуть поставщику. Все решения необратимы. */
function DecisionModal({ q, kind, onClose }: { q: QuarantineItem; kind: Decision; onClose: () => void }) {
  const db = useDB();
  const { me, can } = useSession();
  const ix = indexes(db);
  const p = ix.products.get(q.productId);
  const pu = q.source === 'purchase_defect' ? get(db, 'purchases', q.sourceId) : undefined;
  const supplier = pu ? ix.suppliers.get(pu.supplierId) : undefined;
  const price = pu?.lines.find((l) => l.productId === q.productId)?.price ?? p?.cost ?? 0;
  const sum = price * q.qty;
  const acc = accountantOf(db);
  const [reason, setReason] = useState<WriteoffReason>(q.source === 'purchase_defect' ? 'damage' : /срок|просроч/i.test(q.reason) ? 'expired' : /протек|течёт|течет/i.test(q.reason) ? 'leak' : 'damage');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const where = q.location === 'shop' ? 'в магазине' : 'на складе';

  const submit = () => {
    setError(null);
    if (kind === 'release') {
      const r = act('quarantine.release', { itemId: q.id, comment: comment.trim() || undefined }, me.id);
      if (!r.ok) return setError(r.error);
      toast(r.info ?? 'Возвращено в продажу');
      return onClose();
    }
    if (kind === 'writeoff') {
      const r = act('quarantine.writeoff', { itemId: q.id, reason, comment: comment.trim() || undefined }, me.id);
      if (!r.ok) return setError(r.error);
      const doc = r.id ? get(db, 'stockDocs', r.id) : undefined;
      toast(`Списано ${fmt.qty(q.qty)}${doc ? `, документ № ${doc.number}` : ''}`);
      return onClose();
    }
    if (!supplier) return setError('Поставщик не найден — оформите обычное списание');
    if (!acc) return setError('В программе нет бухгалтера — некому передать возврат');
    const r = act('quarantine.writeoff', { itemId: q.id, reason: 'supplier_return', comment: comment.trim() || `Возврат поставщику ${supplier.name} по закупке № ${pu?.number}: ${q.reason}` }, me.id);
    if (!r.ok) return setError(r.error);
    const t = act(
      'task.create',
      {
        title: `Учесть возврат поставщику ${supplier.name}: ${fmt.qty(q.qty)} на ${fmt.money(sum)} · ${p ? shortName(p) : 'товар'}, закупка № ${pu?.number}`,
        assigneeId: acc.id,
        due: db.meta.today,
        priority: 'normal',
        link: { type: 'supplier', id: supplier.id },
      },
      me.id,
    );
    if (!t.ok) {
      toast(`Товар списан как возврат поставщику, но задача бухгалтеру не создана: ${t.error}`, 'error');
      return onClose();
    }
    toast(`Возврат поставщику оформлен: ${fmt.qty(q.qty)}. Задача бухгалтеру — ${acc.short ?? acc.name}`);
    onClose();
  };

  const title = kind === 'release' ? 'Вернуть в продажу' : kind === 'writeoff' ? 'Списать с проверки' : 'Вернуть поставщику';
  const primary = kind === 'release' ? `Вернуть в продажу ${fmt.qty(q.qty)}` : kind === 'writeoff' ? `Списать ${fmt.qty(q.qty)}` : `Вернуть поставщику ${fmt.qty(q.qty)}`;
  const icon = kind === 'release' ? <RotateCcw /> : kind === 'writeoff' ? <Trash2 /> : <Undo2 />;

  return (
    <Modal
      title={title}
      sub={p?.name ?? ''}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant={kind === 'writeoff' ? 'danger' : 'primary'} icon={icon} onClick={submit}>
            {primary}
          </Button>
        </>
      }
    >
      <div data-hint="stock.q-info">
      <StatList>
        <StatRow label="На проверке" value={<b>{fmt.qty(q.qty)}</b>} />
        <StatRow label="Откуда" value={<span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>{Q_SOURCE[q.source]} · <QSourceLink db={db} q={q} /></span>} />
        <StatRow label="Причина" value={qReason(q)} />
        <StatRow label="Где лежит" value={LOCATION_NAMES[q.location]} />
        {kind === 'supplier' && supplier ? <StatRow label="Поставщик" value={supplier.name} /> : null}
        {kind === 'supplier' && can('seeCost') ? <StatRow total label="По закупочной цене" value={fmt.money(sum)} /> : null}
      </StatList>
      </div>
      {kind === 'writeoff' ? (
        <Field label="Причина списания">
          <Select
            value={reason}
            data-hint="stock.q-reason"
            onChange={(e) => setReason(e.target.value as WriteoffReason)}
            options={(Object.keys(WRITEOFF_REASONS) as WriteoffReason[]).filter((k) => k !== 'supplier_return').map((k) => ({ value: k, label: WRITEOFF_REASONS[k] }))}
          />
        </Field>
      ) : null}
      <Field label="Комментарий">
        <Input
          value={comment}
          data-hint="stock.q-comment"
          onChange={(e) => setComment(e.target.value)}
          placeholder={kind === 'supplier' ? `Например: забрал водитель, накладная на возврат № …` : kind === 'release' ? 'Например: упаковка целая, проверил' : q.reason}
        />
      </Field>
      {kind === 'release' ? (
        <Notice tone="info">Товар целый: {fmt.qty(q.qty)} вернётся в продажу {where}. Отменить решение нельзя</Notice>
      ) : kind === 'writeoff' ? (
        <Notice tone="warn">Списание необратимо: {fmt.qty(q.qty)} уйдёт из учёта {where}</Notice>
      ) : (
        <Notice tone="info" title="Что произойдёт">
          Товар спишем с причиной «{WRITEOFF_REASONS.supplier_return}». {acc ? `${acc.name} получит задачу учесть возврат: ${fmt.qty(q.qty)}${can('seeCost') ? ` на ${fmt.money(sum)}` : ''}` : 'Бухгалтер получит задачу учесть возврат'}. Отменить решение нельзя
        </Notice>
      )}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Modal>
  );
}

export default function QuarantinePage() {
  const db = useDB();
  const version = useDBVersion();
  const { me, can } = useSession();
  const open = useOpenEntity();
  const ix = indexes(db);
  const today = db.meta.today;
  const canDecide = can('inspectQuarantine');
  const [decide, setDecide] = useState<{ q: QuarantineItem; kind: Decision } | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pending = useMemo(() => db.quarantine.filter((q) => q.state === 'check'), [db, version]);
  const decided = useMemo(
    () => db.quarantine.filter((q) => q.state !== 'check').sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? '')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db, version],
  );

  const pname = (q: QuarantineItem) => ix.products.get(q.productId)?.name ?? '—';
  // списание с причиной «Возврат поставщику» показываем отдельным решением
  const returnedIds = useMemo(() => {
    const keys = new Set<string>();
    for (const d of db.stockDocs) if (d.kind === 'writeoff' && d.lines.length === 1 && d.lines[0].reason === 'supplier_return') keys.add(`${d.lines[0].productId}|${d.at}`);
    const ids = new Set<string>();
    for (const q of db.quarantine) if (q.state === 'written_off' && keys.has(`${q.productId}|${q.decidedAt}`)) ids.add(q.id);
    return ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version]);
  const decisionOf = (q: QuarantineItem): StatusDef => (returnedIds.has(q.id) ? { label: 'Возвращён поставщику', tone: 'info' } : QUARANTINE_STATE[q.state]);
  const sourceFilter: FilterDef<QuarantineItem>[] = [
    {
      key: 'source',
      label: 'Откуда',
      showCounts: true,
      options: [
        { value: 'all', label: 'Все' },
        { value: 'return', label: 'Возвраты', test: (q) => q.source === 'return' },
        { value: 'delivery_failed', label: 'Не доставлено', test: (q) => q.source === 'delivery_failed' },
        { value: 'purchase_defect', label: 'Брак при приёмке', test: (q) => q.source === 'purchase_defect' },
      ],
    },
  ];

  const productCol: Column<QuarantineItem> = {
    key: 'product',
    header: 'Товар',
    sort: pname,
    csv: pname,
    render: (q) => {
      const p = ix.products.get(q.productId);
      return (
        <div className="stock-name-cell">
          <div className="cell-title">{p?.name ?? '—'}</div>
          <div className="cell-sub">{p?.sku}</div>
        </div>
      );
    },
  };

  const columns: Column<QuarantineItem>[] = [
    productCol,
    {
      key: 'source',
      header: 'Откуда',
      sort: (q) => Q_SOURCE[q.source],
      csv: (q) => `${Q_SOURCE[q.source]} · ${sourceDoc(db, q)}`,
      render: (q) => (
        <div>
          <div className="w-600 nowrap">{Q_SOURCE[q.source]}</div>
          <div className="cell-sub">
            <QSourceLink db={db} q={q} />
          </div>
        </div>
      ),
    },
    { key: 'place', header: 'Место', sort: (q) => q.location, csv: (q) => LOCATION_NAMES[q.location], render: (q) => LOCATION_NAMES[q.location] },
    { key: 'qty', header: 'Сколько', align: 'right', sort: (q) => q.qty, csv: (q) => q.qty, render: (q) => <span className="stock-q">{fmt.qty(q.qty)}</span>, total: (rs) => fmt.qty(rs.reduce((s, q) => s + q.qty, 0)) },
    { key: 'reason', header: 'Причина', sort: (q) => qReason(q), csv: (q) => qReason(q), render: (q) => <span className="stock-basis" title={q.reason}>{qReason(q)}</span> },
    {
      key: 'at',
      header: 'Когда',
      sort: (q) => q.createdAt,
      csv: (q) => fmt.dateTime(q.createdAt),
      render: (q) => {
        const d = fmt.daysBetween(q.createdAt, today);
        return (
          <div className="nowrap">
            {fmt.relDate(q.createdAt, today)}
            {d >= 3 ? <div className="cell-sub c-warn">ждёт {fmt.count(d, 'день', 'дня', 'дней')}</div> : null}
          </div>
        );
      },
    },
    {
      key: 'act',
      header: '',
      hidden: !canDecide,
      render: (q) => (
        <span className="stock-qactions" onClick={(e) => e.stopPropagation()}>
          {q.source === 'purchase_defect' ? (
            <Button size="sm" icon={<Undo2 />} onClick={() => setDecide({ q, kind: 'supplier' })} title="Брак поставщика: списать как возврат и передать бухгалтеру" data-hint="stock.q-supplier">
              Вернуть поставщику
            </Button>
          ) : quarantineCanRelease(q) ? (
            <Button size="sm" icon={<RotateCcw />} onClick={() => setDecide({ q, kind: 'release' })} title="Проверено, товар целый — вернуть в продажу" data-hint="stock.q-release">
              В продажу
            </Button>
          ) : (
            <span className="t-12 muted" title="Брак и просроченный товар в продажу не возвращают">
              Только списание
            </span>
          )}
          <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => setDecide({ q, kind: 'writeoff' })} data-hint="stock.q-writeoff">
            Списать
          </Button>
        </span>
      ),
    },
  ];

  const histColumns: Column<QuarantineItem>[] = [
    productCol,
    { key: 'state', header: 'Решение', sort: (q) => decisionOf(q).label, csv: (q) => decisionOf(q).label, render: (q) => <StatusChip s={decisionOf(q)} /> },
    { key: 'qty', header: 'Сколько', align: 'right', sort: (q) => q.qty, csv: (q) => q.qty, render: (q) => fmt.qty(q.qty), total: (rs) => fmt.qty(rs.reduce((s, q) => s + q.qty, 0)) },
    { key: 'source', header: 'Откуда', sort: (q) => Q_SOURCE[q.source], csv: (q) => Q_SOURCE[q.source], render: (q) => <span className="nowrap">{Q_SOURCE[q.source]}</span> },
    { key: 'reason', header: 'Причина', sort: (q) => qReason(q), csv: (q) => qReason(q), render: (q) => <span className="stock-basis" title={q.reason}>{qReason(q)}</span> },
    { key: 'who', header: 'Решил', sort: (q) => ix.employees.get(q.decidedBy ?? '')?.name ?? '', csv: (q) => ix.employees.get(q.decidedBy ?? '')?.name ?? '', render: (q) => <span className="nowrap">{ix.employees.get(q.decidedBy ?? '')?.short ?? '—'}</span> },
    { key: 'at', header: 'Когда', sort: (q) => q.decidedAt, csv: (q) => fmt.dateTime(q.decidedAt), render: (q) => <span className="nowrap">{shortWhen(q.decidedAt, today)}</span> },
  ];

  return (
    <>
      <PageHeader section="stock" counts={stockTabCounts(db)} />
      <div className="stock-tight col-4">
      <DataTable
        id="stock-quarantine"
        title={<span data-hint="stock.q-title">На проверке</span>}
        rows={pending}
        columns={columns}
        rowKey={(q) => q.id}
        filters={sourceFilter}
        search={{ placeholder: 'Товар или причина', text: (q) => `${pname(q)} ${q.reason}` }}
        defaultSort={{ key: 'at', dir: 'asc' }}
        onRowClick={(q) => open('product', q.productId)}
        exportName="Карантин"
        totalLabel={(n) => `Итого ${fmt.count(n, 'позиция', 'позиции', 'позиций')}`}
        empty={
          <EmptyState icon={<ShieldCheck />} title="На проверке ничего нет">
            Возвраты и брак проверены: товар либо вернулся в продажу, либо списан
          </EmptyState>
        }
      />
      {decided.length ? (
        <DataTable
          id="stock-quarantine-history"
          title={<span data-hint="stock.q-history">История решений</span>}
          rows={decided}
          columns={histColumns}
          rowKey={(q) => q.id}
          filters={[
            {
              key: 'state',
              label: 'Решение',
              showCounts: true,
              options: [
                { value: 'all', label: 'Все' },
                { value: 'released', label: 'В продажу', test: (q) => q.state === 'released' },
                { value: 'written_off', label: 'Списано', test: (q) => q.state === 'written_off' },
              ],
            },
          ]}
          defaultSort={{ key: 'at', dir: 'desc' }}
          onRowClick={(q) => open('product', q.productId)}
          pageSize={15}
          exportName="Карантин — решения"
          totalLabel={(n) => `Итого ${fmt.count(n, 'решение', 'решения', 'решений')}`}
        />
      ) : (
        <Card title="История решений">
          <EmptyState title="Решений пока не было" />
        </Card>
      )}
      </div>
      {decide ? <DecisionModal q={decide.q} kind={decide.kind} onClose={() => setDecide(null)} /> : null}
    </>
  );
}
