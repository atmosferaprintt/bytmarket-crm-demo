/* Все документы склада одним списком: документы склада и приёмки закупок. */
import type { DB, ID, LocationKey, StockDocKind, WriteoffReason } from '../../data/types';
import { WRITEOFF_REASONS } from '../../data/types';
import { indexes } from '../../data/selectors';
import { memoDb, placeName } from './calc';

export type DocRowKind = StockDocKind | 'receive';

export interface DocRow {
  key: string;
  kind: DocRowKind;
  number: number;
  at: string;
  from: LocationKey | null;
  to: LocationKey | null;
  lines: number;
  qty: number;
  authorId: ID;
  author: string;
  authorShort: string;
  basis: string;
  docId: ID | null;
  purchaseId: ID | null;
  diff: number; // для пересчёта и приёмки: число строк с расхождением
}

export function placeText(r: Pick<DocRow, 'from' | 'to' | 'kind'>): string {
  if (r.kind === 'transfer') return `${placeName(r.from)} — ${placeName(r.to)}`;
  return placeName(r.to ?? r.from);
}

export function docRows(db: DB): DocRow[] {
  return memoDb(db, 'docRows', () => {
    const ix = indexes(db);
    const name = (id: ID) => ix.employees.get(id)?.name ?? '—';
    const short = (id: ID) => ix.employees.get(id)?.short ?? '—';
    const out: DocRow[] = [];
    for (const d of db.stockDocs) {
      let basis = d.comment;
      let diff = 0;
      if (d.kind === 'writeoff') {
        const rs = [...new Set(d.lines.map((l) => l.reason).filter(Boolean) as WriteoffReason[])].map((r) => WRITEOFF_REASONS[r]);
        basis = [rs.join(', '), d.comment].filter(Boolean).join(' · ');
      }
      if (d.kind === 'count') {
        diff = d.lines.filter((l) => l.qty !== (l.expected ?? l.qty)).length;
        basis = d.comment || 'Пересчёт';
      }
      if (d.kind === 'initial' && !basis) basis = 'Остатки на начало учёта';
      out.push({
        key: d.id,
        kind: d.kind,
        number: d.number,
        at: d.at,
        from: d.from,
        to: d.to,
        lines: d.lines.length,
        qty: d.lines.reduce((s, l) => s + l.qty, 0),
        authorId: d.authorId,
        author: name(d.authorId),
        authorShort: short(d.authorId),
        basis,
        docId: d.id,
        purchaseId: d.purchaseId,
        diff,
      });
    }
    // кто принимал закупку: автор последнего движения прихода по ней
    const receiver = new Map<ID, ID>();
    for (const m of db.movements) if (m.docType === 'purchase' && m.kind === 'income') receiver.set(m.docId, m.authorId);
    for (const pu of db.purchases) {
      if (!pu.receivedAt) continue;
      const got = pu.lines.filter((l) => l.received !== null);
      if (!got.length) continue;
      const diff = got.filter((l) => (l.received ?? 0) !== l.qty || l.defect > 0).length;
      const who = receiver.get(pu.id) ?? pu.authorId;
      const sup = ix.suppliers.get(pu.supplierId)?.name ?? 'Поставщик';
      out.push({
        key: 'pu:' + pu.id,
        kind: 'receive',
        number: pu.number,
        at: pu.receivedAt,
        from: null,
        to: pu.location,
        lines: got.length,
        qty: got.reduce((s, l) => s + (l.received ?? 0), 0),
        authorId: who,
        author: name(who),
        authorShort: short(who),
        basis: sup,
        docId: null,
        purchaseId: pu.id,
        diff,
      });
    }
    out.sort((a, b) => b.at.localeCompare(a.at) || b.number - a.number);
    return out;
  });
}
