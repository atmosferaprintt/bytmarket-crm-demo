import { useMemo, useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import type { ID } from '../../data/types';
import { dispatch, useDB } from '../../data/store';
import { useSession } from '../../roles/session';
import { Button, Field, Input, Modal, Notice, Select, fmt, toast } from '../../ui';
import { repList } from './lib';

/** Запланировать визит представителя к закреплённому клиенту. */
export function PlanVisitModal({ repId: fixedRep, clientId: fixedClient, date: fixedDate, onClose }: { repId?: ID; clientId?: ID; date?: string; onClose: () => void }) {
  const db = useDB();
  const { me, role } = useSession();
  const today = db.meta.today;
  const reps = useMemo(() => repList(db), [db]);
  const fixedClientObj = fixedClient ? db.clients.find((c) => c.id === fixedClient) : undefined;

  const [repId, setRepId] = useState<ID>(fixedRep ?? (role === 'rep' ? me.id : fixedClientObj?.ownerId ?? reps[0]?.id ?? ''));
  const repClients = useMemo(
    () => db.clients.filter((c) => c.active && c.ownerId === repId).sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [db, repId],
  );
  const [clientId, setClientId] = useState<ID>(fixedClient ?? '');
  const client = db.clients.find((c) => c.id === clientId);
  const [pointId, setPointId] = useState<ID>(client?.points[0]?.id ?? '');
  const tomorrow = fmt.addDays(today, fmt.weekday(today) === 'суббота' ? 2 : 1);
  const [date, setDate] = useState(fixedDate ?? tomorrow);
  const [time, setTime] = useState('10:00');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  const repLocked = role === 'rep' || !!fixedRep || !!fixedClient;

  const submit = () => {
    setError(null);
    if (!clientId) {
      setError('Выберите клиента');
      return;
    }
    if (date < today) {
      setError('Дата визита уже прошла: выберите сегодня или позже');
      return;
    }
    const r = dispatch('visit.plan', { repId, clientId, pointId: pointId || undefined, date, time, comment: comment.trim() }, me.id);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    toast(`Визит запланирован: ${fmt.relDate(date, today)}, ${time}`);
    onClose();
  };

  return (
    <Modal
      title="Запланировать визит"
      icon={<span className="icon-tile is-ok"><CalendarPlus /></span>}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit}>
            Запланировать
          </Button>
        </>
      }
    >
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <Field label="Представитель">
        <Select
          value={repId}
          disabled={repLocked}
          onChange={(e) => {
            setRepId(e.target.value);
            setClientId('');
            setPointId('');
          }}
          options={reps.map((r) => ({ value: r.id, label: r.name }))}
        />
      </Field>
      <Field label="Клиент">
        {fixedClientObj ? (
          <Input value={fixedClientObj.name} disabled />
        ) : (
          <Select
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              const c = db.clients.find((x) => x.id === e.target.value);
              setPointId(c?.points[0]?.id ?? '');
            }}
            placeholder={repClients.length ? 'Выберите клиента' : 'За представителем нет клиентов'}
            options={repClients.map((c) => ({ value: c.id, label: c.name }))}
          />
        )}
      </Field>
      {client && client.points.length ? (
        <Field label="Точка">
          <Select value={pointId} onChange={(e) => setPointId(e.target.value)} options={client.points.map((p) => ({ value: p.id, label: `${p.name} · ${p.address}` }))} />
        </Field>
      ) : null}
      <div className="grid-2">
        <Field label="Дата">
          <Input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Время">
          <Input type="time" value={time} step={900} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>
      <Field label="Комментарий">
        <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Например: привезти образцы нового геля" />
      </Field>
    </Modal>
  );
}
