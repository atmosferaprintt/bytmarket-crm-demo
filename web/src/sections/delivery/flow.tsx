/* Действия с доставкой: какие доступны по состоянию и правам, и окна для них.
   Использование: const flow = useDeliveryFlow(); flow.act(act, d); … {flow.node} */
import { useState, type ReactNode } from 'react';
import { CircleCheck, CircleX, CalendarClock, Navigation, PackageX, Phone, RotateCcw, Timer, UserPlus, Users } from 'lucide-react';
import type { Delivery, ID, ISODate, Order } from '../../data/types';
import { useDB } from '../../data/store';
import { indexes } from '../../data/selectors';
import type { Perm } from '../../roles/roles';
import { useSession } from '../../roles/session';
import type { MenuItem } from '../../ui';
import { toast } from '../../ui';
import { useRun } from './run';
import { AssignCourierModal, BulkAssignModal, HandInModal, RescheduleModal, ReturnModal } from './modals';
import { DelaySheet, DeliverSheet, FailSheet, LinesSheet } from './CourierSheets';
import { telUrl } from './lib';

/* ---------- какие действия доступны ---------- */

export type ActKey = 'assign' | 'reassign' | 'retry' | 'reschedule' | 'start' | 'deliver' | 'fail' | 'delay' | 'return' | 'call' | 'markDelivered' | 'markFailed';
export interface Act {
  key: ActKey;
  label: string;
  icon: ReactNode;
}

const ACT: Record<ActKey, Act> = {
  assign: { key: 'assign', label: 'Назначить', icon: <UserPlus /> },
  reassign: { key: 'reassign', label: 'Переназначить', icon: <Users /> },
  retry: { key: 'retry', label: 'Повторить доставку', icon: <RotateCcw /> },
  reschedule: { key: 'reschedule', label: 'Перенести', icon: <CalendarClock /> },
  // курьер едет к этой точке: клиенту уходит сообщение «курьер выехал»
  start: { key: 'start', label: 'Еду к клиенту', icon: <Navigation /> },
  deliver: { key: 'deliver', label: 'Вручено', icon: <CircleCheck /> },
  fail: { key: 'fail', label: 'Не удалось', icon: <CircleX /> },
  delay: { key: 'delay', label: 'Задерживаюсь', icon: <Timer /> },
  return: { key: 'return', label: 'Вернуть на склад', icon: <PackageX /> },
  // диспетчер за курьера: курьер позвонил и попросил отметить
  call: { key: 'call', label: 'Позвонить курьеру', icon: <Phone /> },
  markDelivered: { key: 'markDelivered', label: 'Отметить: вручено', icon: <CircleCheck /> },
  markFailed: { key: 'markFailed', label: 'Отметить: не удалось', icon: <CircleX /> },
};

/** Действия по состоянию и правам. prefer — чьи действия ставить главными; courier: false — без действий курьера.
    order — чтобы понять, есть ли что возвращать на склад (товар уже отгружен курьеру). */
export function actsFor(
  d: Delivery,
  can: (p: Perm) => boolean,
  opts: { prefer?: 'courier' | 'dispatch'; courier?: boolean; order?: Order } = {},
): { main: Act | null; more: Act[]; all: Act[] } {
  const A = can('assignDelivery');
  const D = can('deliver') && opts.courier !== false;
  const shipped = opts.order ? opts.order.lines.some((l) => l.shipped > 0) : true;
  const R = (A || can('inspectQuarantine')) && shipped;
  const disp: Act[] = [];
  const cour: Act[] = [];
  switch (d.state) {
    case 'waiting':
      if (A) disp.push(ACT.assign, ACT.reschedule);
      break;
    case 'assigned':
      if (A) disp.push(ACT.reassign, ACT.reschedule);
      if (D) cour.push(ACT.start, ACT.fail, ACT.delay);
      break;
    case 'on_way':
      if (D) cour.push(ACT.deliver, ACT.fail, ACT.delay);
      else if (A) disp.push(ACT.call, ACT.markDelivered, ACT.markFailed);
      break;
    case 'failed':
      if (A) disp.push(ACT.retry, ACT.reschedule);
      if (R) disp.push(ACT.return);
      break;
    default:
      break;
  }
  const all = opts.prefer === 'courier' ? [...cour, ...disp] : [...disp, ...cour];
  return { main: all[0] ?? null, more: all.slice(1), all };
}

/* ---------- окна ---------- */

type Flow =
  | { kind: 'assign' | 'reassign'; id: ID }
  | { kind: 'retry' | 'reschedule'; id: ID }
  | { kind: 'deliver'; id: ID }
  | { kind: 'fail'; id: ID }
  | { kind: 'delay'; id: ID }
  | { kind: 'lines'; id: ID }
  | { kind: 'return'; id: ID }
  | { kind: 'bulk'; ids: ID[]; day: ISODate }
  | { kind: 'handin'; courierId: ID };

export function useDeliveryFlow() {
  const db = useDB();
  const { role } = useSession();
  const [flow, setFlow] = useState<Flow | null>(null);
  const run = useRun();
  const close = () => setFlow(null);

  const act = (a: Act | ActKey, d: Delivery) => {
    const key = typeof a === 'string' ? a : a.key;
    if (key === 'start') {
      run('delivery.start', { deliveryId: d.id }, role === 'courier' ? 'Отмечено: еду к клиенту' : `Доставка № ${d.number}: курьер выехал`);
      return;
    }
    if (key === 'call') {
      const courier = d.courierId ? indexes(db).employees.get(d.courierId) : undefined;
      if (!courier) {
        toast('У доставки нет курьера', 'error');
        return;
      }
      window.location.href = telUrl(courier.phone);
      return;
    }
    if (key === 'markDelivered') return setFlow({ kind: 'deliver', id: d.id });
    if (key === 'markFailed') return setFlow({ kind: 'fail', id: d.id });
    setFlow({ kind: key, id: d.id } as Flow);
  };

  const menu = (acts: Act[], d: Delivery): MenuItem[] =>
    acts.map((a) => ({ label: a.label, icon: a.icon, danger: a.key === 'return', onClick: () => act(a, d) }));

  let node: ReactNode = null;
  if (flow) {
    switch (flow.kind) {
      case 'assign':
      case 'reassign':
        node = <AssignCourierModal id={flow.id} mode={flow.kind} onClose={close} />;
        break;
      case 'retry':
      case 'reschedule':
        node = <RescheduleModal id={flow.id} onClose={close} />;
        break;
      case 'deliver':
        node = <DeliverSheet id={flow.id} onClose={close} />;
        break;
      case 'fail':
        node = <FailSheet id={flow.id} onClose={close} />;
        break;
      case 'delay':
        node = <DelaySheet id={flow.id} onClose={close} />;
        break;
      case 'lines':
        node = <LinesSheet id={flow.id} onClose={close} />;
        break;
      case 'return':
        node = <ReturnModal id={flow.id} onClose={close} />;
        break;
      case 'bulk':
        node = <BulkAssignModal ids={flow.ids} day={flow.day} onClose={close} />;
        break;
      case 'handin':
        node = <HandInModal courierId={flow.courierId} onClose={close} />;
        break;
    }
  }

  return {
    act,
    menu,
    lines: (d: Delivery) => setFlow({ kind: 'lines', id: d.id }),
    bulk: (ids: ID[], day: ISODate) => setFlow({ kind: 'bulk', ids, day }),
    handIn: (courierId: ID) => setFlow({ kind: 'handin', courierId }),
    node,
  };
}
