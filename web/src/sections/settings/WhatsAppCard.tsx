/* WhatsApp магазина в «Подключениях»: номер, как идёт переписка, автосообщения с переключателями и пример того, что видит клиент.
   Пример подключения: сообщения сохраняются в программе и наружу не уходят. */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCheck, MessageCircle, Zap } from 'lucide-react';
import type { ChatMessage, WaAutoKey } from '../../data/types';
import { WA_AUTO_KEYS } from '../../data/types';
import { dispatch, useDB, useDBVersion } from '../../data/store';
import { useSession } from '../../roles/session';
import { Button, ConfirmButton, IconTile, StatList, StatRow, StatusChip, Switch, cx, fmt, toast } from '../../ui';
import { WA_AUTO_META } from '../../data/whatsapp';

export function WhatsAppCard() {
  const db = useDB();
  const version = useDBVersion();
  const navigate = useNavigate();
  const { me, role } = useSession();
  const wa = db.settings.whatsapp;
  const today = db.meta.today;
  const isOwner = role === 'owner';
  const [sel, setSel] = useState<WaAutoKey>('on_way');

  const d = useMemo(() => {
    const from7 = fmt.addDays(today, -6);
    const from30 = fmt.addDays(today, -29);
    let msgs7 = 0;
    const auto7 = new Map<WaAutoKey, number>();
    const latest = new Map<WaAutoKey, ChatMessage>();
    let waiting = 0;
    for (const ch of db.chats) {
      const last = ch.messages[ch.messages.length - 1];
      if (last?.from === 'client') waiting++;
      for (const m of ch.messages) {
        if (m.at.slice(0, 10) >= from7) {
          msgs7++;
          if (m.auto) auto7.set(m.auto, (auto7.get(m.auto) ?? 0) + 1);
        }
        if (m.auto && (!latest.get(m.auto) || latest.get(m.auto)!.at < m.at)) latest.set(m.auto, m);
      }
    }
    const fromChat = db.orders.filter((o) => o.source === 'chat' && o.state !== 'cancelled' && o.createdAt.slice(0, 10) >= from30);
    return { msgs7, auto7, latest, waiting, chatOrders: fromChat.length, chatSum: fromChat.reduce((s, o) => s + o.total, 0) };
  }, [db, version, today]);

  const toggle = (k: WaAutoKey, v: boolean) => {
    const r = dispatch('settings.whatsapp', { auto: { [k]: v } }, me.id);
    if (!r.ok) return toast(r.error, 'error');
    toast(`Автосообщение «${WA_AUTO_META[k].label}» ${v ? 'включено' : 'выключено'}`);
  };
  const connect = (v: boolean) => {
    const r = dispatch('settings.whatsapp', { connected: v }, me.id);
    if (!r.ok) return toast(r.error, 'error');
    toast(v ? 'WhatsApp подключён' : 'WhatsApp отключён: сообщения не приходят и не отправляются');
  };

  const sample = d.latest.get(sel);
  const client = sample ? db.clients.find((c) => db.chats.some((ch) => ch.clientId === c.id && ch.messages.includes(sample))) : undefined;

  return (
    <section className="card set-int is-wide">
      <div className="set-int-head">
        <IconTile>
          <MessageCircle />
        </IconTile>
        <span className="set-int-title grow">WhatsApp</span>
        <StatusChip s={wa.connected ? { label: 'Подключён', tone: 'ok' } : { label: 'Отключён', tone: 'warn' }} />
      </div>
      <div className="set-int-what">
        Клиенты пишут на номер магазина {fmt.phone(wa.phone)}. Переписка — в разделе «Чаты» и в карточке клиента, заказ из сообщения оформляется кнопкой «Разобрать в заказ». О заказе, доставке и оплате клиент узнаёт из автосообщений.
      </div>
      <div className="wa-set-grid">
        <div className="col" style={{ gap: 10 }}>
          <span className="set-int-label" data-hint="settings.wa.stats">Переписка</span>
          <StatList>
            <StatRow label="Номер магазина" value={fmt.phone(wa.phone)} />
            <StatRow label="Подключён" value={wa.since ? `с ${fmt.date(wa.since)}` : 'нет'} />
            <StatRow label="Диалогов" value={fmt.num(db.chats.length)} />
            <StatRow label="Сообщений за 7 дней" value={fmt.num(d.msgs7)} />
            <StatRow label="Ждут ответа" value={fmt.num(d.waiting)} />
            <StatRow label="Заказов из переписки за 30 дней" value={`${fmt.num(d.chatOrders)} на ${fmt.money(d.chatSum)}`} />
          </StatList>
        </div>

        <div className="col" style={{ gap: 10 }}>
          <span className="row">
            <span className="set-int-label grow">Автосообщения</span>
            <span className="set-int-label">За 7 дней</span>
          </span>
          <div className="wa-auto-list" role="list" data-hint="settings.wa.auto">
            {WA_AUTO_KEYS.map((k) => (
              <div key={k} role="listitem" className={cx('wa-auto-row', sel === k && 'is-active')} onClick={() => setSel(k)}>
                <span onClick={(e) => e.stopPropagation()}>
                  <Switch checked={wa.auto[k]} onChange={(v) => toggle(k, v)} disabled={!isOwner || !wa.connected} label={isOwner ? `${WA_AUTO_META[k].label}: ${wa.auto[k] ? 'выключить' : 'включить'}` : 'Меняет владелец'} />
                </span>
                <button type="button" className="wa-auto-text" onClick={() => setSel(k)}>
                  <span className="w-600 t-13">{WA_AUTO_META[k].label}</span>
                  <span className="t-12 muted">{WA_AUTO_META[k].when}</span>
                </button>
                <span className="num t-13 w-600">{fmt.num(d.auto7.get(k) ?? 0)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="col" style={{ gap: 10 }}>
          <span className="set-int-label">Так видит клиент · {WA_AUTO_META[sel].label}</span>
          <div className="set-chat wa-preview" data-hint="settings.wa.preview">
            {sample ? (
              <>
                <span className="t-11 muted" style={{ alignSelf: 'center' }}>
                  {client?.name ?? 'Клиент'} · {fmt.relDate(sample.at.slice(0, 10), today)}
                </span>
                <div className="set-bubble is-staff">
                  <span className="wa-auto-label">
                    <Zap size={12} />
                    Автосообщение
                  </span>
                  <div>{sample.text.replace(/№ /g, '№\u00a0')}</div>
                  <span className="set-bubble-time">
                    {fmt.time(sample.at)} <CheckCheck size={14} className="wa-read" style={{ verticalAlign: '-3px' }} />
                  </span>
                </div>
              </>
            ) : (
              <span className="t-13 muted">Ещё не отправлялось</span>
            )}
          </div>
          {!wa.auto[sel] ? <span className="t-12 muted">Сейчас выключено — клиенты его не получают</span> : null}
        </div>
      </div>
      <div className="set-int-foot" data-hint="settings.wa.foot">
        <Button onClick={() => navigate('/chats')}>Открыть чаты</Button>
        {isOwner ? (
          wa.connected ? (
            <ConfirmButton variant="ghost" confirmText="Отключить WhatsApp?" onConfirm={() => connect(false)}>
              Отключить
            </ConfirmButton>
          ) : (
            <Button onClick={() => connect(true)}>Подключить снова</Button>
          )
        ) : null}
      </div>
    </section>
  );
}
