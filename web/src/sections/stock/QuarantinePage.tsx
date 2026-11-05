/* Склад → Карантин: товар на проверке и история решений. В продажу — только после проверки. */
import { useMemo, useState } from 'react';
import { RotateCcw, ShieldCheck, Trash2 } from 'lucide-react';
import type { DB, QuarantineItem, WriteoffReason } from '../../data/types';
import { LOCATION_NAMES, WRITEOFF_REASONS } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { indexes } from '../../data/selectors';
import { get } from '../../data/idx';
import { useSession } from '../../roles/session';
import { PageHeader } from '../../shell/PageHeader';
import { EntityLink, useOpenEntity } from '../../shell/entities';
import { Button, Card, DataTable, EmptyState, Field, Input, Modal, Notice, Select, StatusChip, QUARANTINE_STATE, fmt, toast, type Column, type FilterDef } from '../../ui';
import { stockTabCounts } from './picking';
import { act } from './act';
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

function WriteoffModal({ q, onClose }: { q: QuarantineItem; onClose: () => void }) {
  const db = useDB();
  const { me } = useSession();
  const p = indexes(db).products.get(q.productId);
  const [reason, setReason] = useState<WriteoffReason>(q.source === 'purchase_defect' ? 'damage' : /срок|просроч/i.test(q.reason) ? 'expired' : /протек|течёт|течет/i.test(q.reason) ? 'leak' : 'damage');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    const r = act('quarantine.writeoff', { itemId: q.id, reason, comment: comment.trim() || undefined }, me.id);
    if (!r.ok) return setError(r.error);
    const doc = r.id ? get(db, 'stockDocs', r.id) : undefined;
    toast(`Списано ${fmt.qty(q.qty)}${doc ? `, документ № ${doc.number}` : ''}`);
    onClose();
  };
  return (
    <Modal
      title="Списать с проверки"
      sub={`${p?.name ?? ''} · ${fmt.qty(q.qty)}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" icon={<Trash2 />} onClick={submit}>
            Списать {fmt.qty(q.qty)}
          </Button>
        </>
      }
    >
      <Field label="Причина списания">
        <Select value={reason} onChange={(e) => setReason(e.target.value as WriteoffReason)} options={(Object.keys(WRITEOFF_REASONS) as WriteoffReason[]).map((k) => ({ value: k, label: WRITEOFF_REASONS[k] }))} />
      </Field>
      <Field label="Комментарий">
        <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder={q.reason} />
      </Field>
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
  const [wo, setWo] = useState<QuarantineItem | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pending = useMemo(() => db.quarantine.filter((q) => q.state === 'check'), [db, version]);
  const decided = useMemo(
    () => db.quarantine.filter((q) => q.state !== 'check').sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? '')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db, version],
  );

  const release = (q: QuarantineItem) => {
    const r = act('quarantine.release', { itemId: q.id }, me.id);
    if (!r.ok) return toast(r.error, 'error');
    toast(r.info ?? 'Возвращено в продажу');
  };

  const pname = (q: QuarantineItem) => ix.products.get(q.productId)?.name ?? '—';
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
          <Button size="sm" icon={<RotateCcw />} onClick={() => release(q)} title="Проверено, товар целый — вернуть в продажу">
            В продажу
          </Button>
          <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => setWo(q)}>
            Списать
          </Button>
        </span>
      ),
    },
  ];

  const histColumns: Column<QuarantineItem>[] = [
    productCol,
    { key: 'state', header: 'Решение', sort: (q) => q.state, csv: (q) => QUARANTINE_STATE[q.state].label, render: (q) => <StatusChip s={QUARANTINE_STATE[q.state]} /> },
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
        title="На проверке"
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
          title="История решений"
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
      {wo ? <WriteoffModal q={wo} onClose={() => setWo(null)} /> : null}
    </>
  );
}
