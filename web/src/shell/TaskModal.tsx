import { useState } from 'react';
import type { ID, TaskKind, TaskLink } from '../data/types';
import { dispatch, useDB } from '../data/store';
import { useSession } from '../roles/session';
import { Button, Field, Input, Modal, Select, Segmented, toast } from '../ui';

/** Новая задача. Можно привязать к клиенту, заказу, доставке, товару, закупке, платежу или поставщику.
    kind — вид задачи: такая закроется сама, когда дело сделают (напомнили об оплате, разнесли платёж). */
export function TaskModal({
  link,
  assigneeId,
  onClose,
  defaultTitle = '',
  kind,
  title: modalTitle = 'Новая задача',
  onDone,
}: {
  link?: TaskLink | null;
  assigneeId?: ID | null;
  onClose: () => void;
  defaultTitle?: string;
  kind?: TaskKind;
  title?: string;
  onDone?: () => void;
}) {
  const db = useDB();
  const { me } = useSession();
  const [title, setTitle] = useState(defaultTitle);
  const [who, setWho] = useState<ID>(assigneeId ?? me.id);
  const [due, setDue] = useState(db.meta.today);
  const [dueTime, setDueTime] = useState('');
  const [priority, setPriority] = useState<'normal' | 'high'>('normal');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!title.trim()) {
      setError('Напишите, что нужно сделать');
      return;
    }
    const r = dispatch('task.create', { title: title.trim(), assigneeId: who, due, dueTime: dueTime || null, priority, link: link ?? null, ...(kind ? { kind } : {}) }, me.id);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const e = db.employees.find((x) => x.id === who);
    toast(who === me.id ? 'Задача поставлена' : `Задача поставлена: ${e?.short ?? e?.name ?? 'сотруднику'}`);
    onDone?.();
    onClose();
  };

  return (
    <Modal
      title={modalTitle}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit}>
            Поставить задачу
          </Button>
        </>
      }
    >
      <Field label="Что сделать" error={error}>
        <Input autoFocus value={title} onChange={(e) => { setTitle(e.target.value); setError(null); }} placeholder="Например: позвонить по оплате заказа" onKeyDown={(e) => e.key === 'Enter' && submit()} />
      </Field>
      <div className="grid-2">
        <Field label="Исполнитель">
          <Select value={who} onChange={(e) => setWho(e.target.value)} options={db.employees.filter((e) => e.active).map((e) => ({ value: e.id, label: e.name }))} />
        </Field>
        <Field label="Важность">
          <Segmented value={priority} onChange={setPriority} options={[{ value: 'normal', label: 'Обычная' }, { value: 'high', label: 'Срочно' }]} />
        </Field>
        <Field label="Срок">
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field label="Время, если важно">
          <Input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
