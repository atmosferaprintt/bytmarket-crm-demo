import { useMemo, useState } from 'react';
import { MapPin, Plus, Trash2, UserRound } from 'lucide-react';
import type { Client, ClientContact, ClientKind, ClientPoint, ClientSegment, ID, PriceType } from '../../data/types';
import { CLIENT_KIND_NAMES, CLIENT_SEGMENT_NAMES } from '../../data/types';
import { dispatch, useDB } from '../../data/store';
import { useSession } from '../../roles/session';
import { Button, Field, Input, Modal, MoneyInput, Notice, Segmented, Select, Textarea, toast } from '../../ui';
import { DISTRICTS } from './lib';
import { isInn } from '../../data/codes';

interface PointDraft {
  key: string;
  id?: ID;
  name: string;
  address: string;
  district: string;
  lat?: number;
  lng?: number;
}
interface ContactDraft {
  key: string;
  id?: ID;
  name: string;
  role: string;
  phone: string;
}

let rowSeq = 0;
const rowKey = () => `r${++rowSeq}`;

const KINDS: ClientKind[] = ['ip', 'ooo', 'person'];
const SEGMENTS = Object.keys(CLIENT_SEGMENT_NAMES) as ClientSegment[];
const CONTACT_ROLES = ['Владелец', 'Директор', 'Закупщик', 'Управляющая', 'Бухгалтер', 'Продавец', 'Завхоз', 'Администратор'];

const toNum = (v: number | '') => (v === '' ? 0 : v);

/** Новый клиент или правка карточки. Тип лица, сегмент и тип цены — три разных поля. */
export function ClientFormModal({ client, onClose, onSaved }: { client?: Client; onClose: () => void; onSaved?: (id: ID) => void }) {
  const db = useDB();
  const { me, role } = useSession();
  const editing = !!client;

  const [kind, setKind] = useState<ClientKind>(client?.kind ?? 'ip');
  const [segment, setSegment] = useState<ClientSegment>(client?.segment ?? 'shop');
  const [priceType, setPriceType] = useState<PriceType>(client?.priceType ?? 'wholesale');
  const [priceTouched, setPriceTouched] = useState(editing);
  const [name, setName] = useState(client?.name ?? '');
  const [inn, setInn] = useState(client?.inn ?? '');
  const [phone, setPhone] = useState(client?.phone ?? '');
  // без кредита отсрочки нет: у нового клиента отсрочка 0, пока не задан кредитный лимит; лимит появился — подставляем обычную отсрочку
  const [deferDays, setDeferDays] = useState(String(client?.deferDays ?? 0));
  const [deferTouched, setDeferTouched] = useState(editing);
  const [creditLimit, setCreditLimitRaw] = useState<number | ''>(client?.creditLimit ?? 0);
  const setCreditLimit = (v: number | '') => {
    setCreditLimitRaw(v);
    if (!deferTouched) setDeferDays(String(toNum(v) > 0 ? db.settings.defaultDeferDays ?? 0 : 0));
  };
  const [minOrder, setMinOrder] = useState<number | ''>(client?.minOrder ?? 0);
  const [every, setEvery] = useState(client?.orderEveryDays ? String(client.orderEveryDays) : '');
  const [ownerId, setOwnerId] = useState<string>(client ? client.ownerId ?? '' : role === 'manager' || role === 'rep' ? me.id : '');
  const [note, setNote] = useState(client?.note ?? '');
  const [points, setPoints] = useState<PointDraft[]>(() =>
    client?.points.length
      ? client.points.map((p) => ({ key: rowKey(), id: p.id, name: p.name, address: p.address, district: p.district, lat: p.lat, lng: p.lng }))
      : [{ key: rowKey(), name: '', address: '', district: DISTRICTS[0].name }],
  );
  const [contacts, setContacts] = useState<ContactDraft[]>(() =>
    client?.contacts.length
      ? client.contacts.map((c) => ({ key: rowKey(), id: c.id, name: c.name, role: c.role, phone: c.phone }))
      : [{ key: rowKey(), name: '', role: 'Владелец', phone: '' }],
  );
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState(false);
  const [innError, setInnError] = useState<string | null>(null);

  const owners = useMemo(
    () =>
      db.employees
        .filter((e) => e.active && e.roles.some((r) => r === 'manager' || r === 'rep'))
        .map((e) => ({ value: e.id, label: `${e.name} · ${e.roles.includes('manager') ? 'менеджер' : 'представитель'}` })),
    [db],
  );
  const ownerLocked = role === 'rep';

  const onSegment = (s: ClientSegment) => {
    setSegment(s);
    if (!priceTouched) setPriceType(s === 'retail' ? 'retail' : 'wholesale');
    if (s === 'retail' && kind !== 'person' && !editing) setKind('person');
  };

  const setPoint = (key: string, patch: Partial<PointDraft>) => setPoints((a) => a.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const setContact = (key: string, patch: Partial<ContactDraft>) => setContacts((a) => a.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  const submit = () => {
    setError(null);
    if (!name.trim()) {
      setNameError(true);
      setError('Напишите название клиента: как его называют в магазине');
      return;
    }
    // ИНН проверяем сразу и подсвечиваем само поле
    const innValue = inn.trim();
    if (innValue && !isInn(innValue)) {
      setInnError(innValue.length !== 10 && innValue.length !== 12 ? 'Нужно 10 цифр у организации или 12 у ИП' : 'ИНН не сходится: проверьте цифры');
      return;
    }
    if (innValue && db.clients.some((x) => x.inn === innValue && x.id !== client?.id)) {
      setInnError('Клиент с таким ИНН уже есть');
      return;
    }
    const filledPoints = points.filter((p) => p.name.trim() || p.address.trim());
    const badPoint = filledPoints.find((p) => !p.name.trim() || !p.address.trim());
    if (badPoint) {
      setError('У точки нужны и название, и адрес. Заполните оба поля или удалите строку.');
      return;
    }
    const filledContacts = contacts.filter((c) => c.name.trim() || c.phone.trim());
    const badContact = filledContacts.find((c) => !c.name.trim() || !c.phone.trim());
    if (badContact) {
      setError('У контакта нужны имя и телефон. Заполните оба поля или удалите строку.');
      return;
    }
    if (segment !== 'retail' && !ownerId) {
      setError('Выберите ответственного: менеджера или представителя');
      return;
    }
    const pts: Partial<ClientPoint>[] = filledPoints.map((p) => {
      const d = DISTRICTS.find((x) => x.name === p.district) ?? DISTRICTS[0];
      const jitter = () => (Math.random() - 0.5) * 0.02;
      return {
        ...(p.id ? { id: p.id } : {}),
        name: p.name.trim(),
        address: p.address.trim(),
        district: p.district,
        lat: p.lat ?? +(d.lat + jitter()).toFixed(5),
        lng: p.lng ?? +(d.lng + jitter()).toFixed(5),
      };
    });
    const cts: Partial<ClientContact>[] = filledContacts.map((c) => ({ ...(c.id ? { id: c.id } : {}), name: c.name.trim(), role: c.role.trim(), phone: c.phone.trim() }));
    const fields = {
      name: name.trim(),
      kind,
      segment,
      priceType,
      inn: inn.trim() || null,
      phone: phone.trim(),
      deferDays: Math.max(0, Math.round(Number(deferDays) || 0)),
      creditLimit: toNum(creditLimit),
      minOrder: toNum(minOrder),
      orderEveryDays: every.trim() ? Math.max(1, Math.round(Number(every) || 0)) : null,
      ownerId: ownerId || null,
      note: note.trim(),
      points: pts,
      contacts: cts,
    };

    if (!client) {
      const r = dispatch('client.create', fields as unknown as Partial<Client>, me.id);
      if (!r.ok) {
        if (/ИНН/.test(r.error)) setInnError(r.error);
        else setError(r.error);
        return;
      }
      toast(`Клиент «${fields.name}» добавлен`);
      onSaved?.(r.id ?? '');
      onClose();
      return;
    }

    // правка: отправляем только то, что поменялось
    const patch: Record<string, unknown> = {};
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    (['name', 'kind', 'segment', 'priceType', 'inn', 'phone', 'deferDays', 'creditLimit', 'minOrder', 'orderEveryDays', 'note'] as const).forEach((k) => {
      if (!same(fields[k], client[k])) patch[k] = fields[k];
    });
    if (!ownerLocked && fields.ownerId !== client.ownerId) patch.ownerId = fields.ownerId;
    const cmpPoints = (a: Partial<ClientPoint>[]) => a.map((p) => [p.id ?? '', p.name, p.address, p.district]);
    if (!same(cmpPoints(pts), cmpPoints(client.points))) patch.points = pts;
    const cmpContacts = (a: Partial<ClientContact>[]) => a.map((c) => [c.id ?? '', c.name, c.role, c.phone]);
    if (!same(cmpContacts(cts), cmpContacts(client.contacts))) patch.contacts = cts;
    if (!Object.keys(patch).length) {
      onClose();
      return;
    }
    const r = dispatch('client.update', { clientId: client.id, patch: patch as Partial<Client> }, me.id);
    if (!r.ok) {
      if (/ИНН/.test(r.error)) setInnError(r.error);
      else setError(r.error);
      return;
    }
    toast('Карточка клиента сохранена');
    onSaved?.(client.id);
    onClose();
  };

  return (
    <Modal
      wide
      title={editing ? 'Изменить клиента' : 'Новый клиент'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit}>
            {editing ? 'Сохранить' : 'Добавить клиента'}
          </Button>
        </>
      }
    >
      {error ? <Notice tone="bad">{error}</Notice> : null}

      <div className="cl-form-grid">
        <Field label="Тип лица">
          <Segmented value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k, label: CLIENT_KIND_NAMES[k] }))} />
        </Field>
        <Field label="Сегмент">
          <Select value={segment} onChange={(e) => onSegment(e.target.value as ClientSegment)} options={SEGMENTS.map((s) => ({ value: s, label: CLIENT_SEGMENT_NAMES[s] }))} />
        </Field>
        <Field label="Тип цены" hint={priceType === 'wholesale' ? 'Оптовые цены из прайса' : 'Розничные цены, как на кассе'}>
          <Segmented
            value={priceType}
            onChange={(v) => {
              setPriceType(v);
              setPriceTouched(true);
            }}
            options={[
              { value: 'wholesale', label: 'Опт' },
              { value: 'retail', label: 'Розница' },
            ]}
          />
        </Field>
      </div>

      <div className="cl-form-grid">
        <Field label="Название" className="cl-span-2" error={nameError && !name.trim() ? 'Обязательно' : undefined}>
          <Input
            autoFocus={!editing}
            value={name}
            invalid={nameError && !name.trim()}
            onChange={(e) => setName(e.target.value)}
            placeholder={kind === 'person' ? 'Имя и фамилия' : 'Например: ИП Гамзатова, магазин «Чистый дом»'}
          />
        </Field>
        <Field label="ИНН" error={innError ?? undefined}>
          <Input
            value={inn}
            invalid={!!innError}
            onChange={(e) => {
              setInn(e.target.value.replace(/[^\d]/g, '').slice(0, 12));
              setInnError(null);
            }}
            inputMode="numeric"
            placeholder={kind === 'person' ? 'Не обязательно' : '10 или 12 цифр'}
          />
        </Field>
        <Field label="Телефон">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="+7 917 123-45-67" />
        </Field>
        <Field label="Ответственный">
          <Select
            value={ownerId}
            disabled={ownerLocked}
            onChange={(e) => setOwnerId(e.target.value)}
            options={owners}
            placeholder={segment === 'retail' ? 'Без ответственного' : 'Выберите сотрудника'}
          />
        </Field>
      </div>

      <h3 className="cl-form-title">Условия</h3>
      <div className="cl-form-grid cl-form-grid-4">
        <Field label="Отсрочка, дней">
          <Input
            value={deferDays}
            onChange={(e) => {
              setDeferDays(e.target.value.replace(/[^\d]/g, '').slice(0, 3));
              setDeferTouched(true);
            }}
            inputMode="numeric"
            className="num"
            placeholder="0 — оплата сразу"
          />
        </Field>
        <Field label="Кредитный лимит">
          <MoneyInput value={creditLimit} onChange={setCreditLimit} placeholder="0 — без кредита" />
        </Field>
        <Field label="Минимальная сумма заказа">
          <MoneyInput value={minOrder} onChange={setMinOrder} placeholder="0 — без минимума" />
        </Field>
        <Field label="Обычно заказывает раз в, дней">
          <Input value={every} onChange={(e) => setEvery(e.target.value.replace(/[^\d]/g, '').slice(0, 3))} inputMode="numeric" className="num" placeholder="Не знаем" />
        </Field>
      </div>

      <div className="cl-form-section">
        <div className="row">
          <h3 className="cl-form-title grow">Торговые точки</h3>
          <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setPoints((a) => [...a, { key: rowKey(), name: '', address: '', district: DISTRICTS[0].name }])}>
            Добавить точку
          </Button>
        </div>
        {points.length ? (
          <div className="cl-rows">
            {points.map((p, i) => (
              <div key={p.key} className="cl-row-edit cl-row-point">
                <span className="cl-row-icon">
                  <MapPin />
                </span>
                <Input value={p.name} onChange={(e) => setPoint(p.key, { name: e.target.value })} placeholder={i === 0 ? 'Название: магазин на Боевой' : 'Название точки'} aria-label="Название точки" />
                <Input value={p.address} onChange={(e) => setPoint(p.key, { address: e.target.value })} placeholder="Адрес: ул. Боевая, 61" aria-label="Адрес" />
                <Select value={p.district} onChange={(e) => setPoint(p.key, { district: e.target.value })} options={DISTRICTS.map((d) => ({ value: d.name, label: d.name }))} aria-label="Район" />
                <Button variant="ghost" iconOnly aria-label="Удалить точку" title="Удалить точку" onClick={() => setPoints((a) => a.filter((x) => x.key !== p.key))}>
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted t-13">Точек нет — покупает в магазине или забирает сам.</div>
        )}
      </div>

      <div className="cl-form-section">
        <div className="row">
          <h3 className="cl-form-title grow">Контакты</h3>
          <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setContacts((a) => [...a, { key: rowKey(), name: '', role: 'Закупщик', phone: '' }])}>
            Добавить контакт
          </Button>
        </div>
        {contacts.length ? (
          <div className="cl-rows">
            {contacts.map((c) => (
              <div key={c.key} className="cl-row-edit cl-row-contact">
                <span className="cl-row-icon">
                  <UserRound />
                </span>
                <Input value={c.name} onChange={(e) => setContact(c.key, { name: e.target.value })} placeholder="Имя: Зайнаб Гамзатова" aria-label="Имя контакта" />
                <Select
                  value={c.role}
                  onChange={(e) => setContact(c.key, { role: e.target.value })}
                  options={[...new Set([...CONTACT_ROLES, c.role].filter(Boolean))].map((r) => ({ value: r, label: r }))}
                  aria-label="Должность"
                />
                <Input value={c.phone} onChange={(e) => setContact(c.key, { phone: e.target.value })} inputMode="tel" placeholder="+7 917 123-45-67" aria-label="Телефон контакта" />
                <Button variant="ghost" iconOnly aria-label="Удалить контакт" title="Удалить контакт" onClick={() => setContacts((a) => a.filter((x) => x.key !== c.key))}>
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted t-13">Контактов нет.</div>
        )}
      </div>

      <Field label="Заметка">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Например: принимает товар с 9 до 12, вход со двора" rows={2} />
      </Field>
    </Modal>
  );
}
