import { useState } from 'react';
import { Button, Field, Input, Modal, Notice } from '../../../ui';
import { FIELD_LABEL, type Catalog, type FieldKey, type PreviewRow } from './importer';

/** Исправить одну строку таблицы прямо в программе — без возврата в Excel. */
export function FixRowModal({
  row,
  cells,
  mapping,
  catalog,
  onSave,
  onRemove,
  onClose,
}: {
  row: PreviewRow;
  cells: string[];
  mapping: (FieldKey | null)[];
  catalog: Catalog;
  onSave: (cells: string[]) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<string[]>(() => mapping.map((_, i) => cells[i] ?? ''));
  const problems = row.issues.filter((i) => i.level !== 'note');
  const cols = mapping.map((f, i) => ({ f, i })).filter((x): x is { f: FieldKey; i: number } => x.f !== null);
  const bad = new Set(row.issues.filter((i) => i.level === 'error').map((i) => i.field));

  return (
    <Modal
      title={`Строка ${row.line}`}
      sub={row.name || 'Без названия'}
      wide
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onRemove}>
            Убрать строку из загрузки
          </Button>
          <span className="spacer" />
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={() => onSave(draft)}>
            Применить
          </Button>
        </>
      }
    >
      <div className="col-4">
        {problems.length ? (
          <Notice tone={problems.some((p) => p.level === 'error') ? 'bad' : 'warn'}>
            {problems.map((p, k) => (
              <div key={k}>{p.text}</div>
            ))}
          </Notice>
        ) : null}
        <div className="set-form">
          {cols.map(({ f, i }) => (
            <Field key={i} label={FIELD_LABEL[f]} className={f === 'name' ? 'is-wide' : undefined}>
              <Input
                value={draft[i]}
                invalid={bad.has(f)}
                list={f === 'brand' ? 'set-brands' : f === 'category' ? 'set-cats' : undefined}
                inputMode={f === 'name' || f === 'brand' || f === 'category' ? undefined : 'numeric'}
                onChange={(e) => setDraft((d) => d.map((v, k) => (k === i ? e.target.value : v)))}
              />
            </Field>
          ))}
        </div>
        <datalist id="set-brands">
          {catalog.brandNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <datalist id="set-cats">
          {catalog.catNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </div>
    </Modal>
  );
}
