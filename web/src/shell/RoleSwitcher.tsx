import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check, RotateCcw } from 'lucide-react';
import { Avatar, Button, ConfirmButton, Modal, cx, toast } from '../ui';
import { resetDemo, useDB } from '../data/store';
import { ROLE_ORDER, ROLES } from '../roles/roles';
import { useSession } from '../roles/session';

/** «Посмотреть глазами сотрудника». Один вход — внизу меню (на телефоне — аватар в шапке). */
export function RoleSwitcher({ onClose }: { onClose: () => void }) {
  const db = useDB();
  const { me, role, switchTo } = useSession();
  const navigate = useNavigate();

  return (
    <Modal
      wide
      title="Посмотреть глазами сотрудника"
      sub="У каждой роли свой рабочий стол, меню и границы данных. Вход по паролю появится в рабочей версии."
      onClose={onClose}
      footer={
        <>
          <ConfirmButton
            variant="ghost"
            icon={<RotateCcw />}
            confirmText="Стереть все изменения?"
            onConfirm={() => {
              resetDemo();
              toast('Данные возвращены к исходным');
              onClose();
              navigate('/overview');
            }}
          >
            Вернуть исходные данные
          </ConfirmButton>
          <span className="spacer" />
          <Button variant="secondary" onClick={onClose}>
            Закрыть
          </Button>
        </>
      }
    >
      <div className="grid-2">
        {ROLE_ORDER.map((r) => {
          const meta = ROLES[r];
          const people = db.employees
            .filter((e) => e.active && e.roles.includes(r))
            .sort((a, b) => Number(b.roles[0] === r) - Number(a.roles[0] === r));
          const person = r === role ? me : people[0];
          if (!person) return null;
          const active = r === role && person.id === me.id;
          return (
            <div key={r} className={cx('card', 'role-card', active && 'is-active')}>
              <button
                type="button"
                className="role-card-main"
                onClick={() => {
                  switchTo(person.id, r);
                  onClose();
                  navigate('/overview');
                }}
              >
                <Avatar name={person.name} size="lg" navy={active} />
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="row" style={{ gap: 8 }}>
                    <span className="t-14 w-700 ellipsis">{person.name}</span>
                  </span>
                  <span className="t-13 w-600 ink-2" style={{ display: 'block' }}>
                    {meta.name}
                  </span>
                  <span className="t-12 muted" style={{ display: 'block', marginTop: 4 }}>
                    {meta.about}
                  </span>
                  <span className="t-12 faint" style={{ display: 'block', marginTop: 2 }}>
                    Видит: {meta.sees}
                  </span>
                </span>
                {active ? <Check size={18} color="var(--ok)" /> : <ArrowRight size={18} color="var(--faint)" />}
              </button>
              {people.length > 1 ? (
                <div className="role-card-people">
                  {people.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={cx('chip', 'chip-outline', p.id === person.id && r === role && 'is-current')}
                      onClick={() => {
                        switchTo(p.id, r);
                        onClose();
                        navigate('/overview');
                      }}
                    >
                      {p.short}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
