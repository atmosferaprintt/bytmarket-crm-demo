import { useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Clock, HardDrive, Landmark, Layers, RotateCcw, ScanBarcode } from 'lucide-react';
import { PageHeader } from '../../shell/PageHeader';
import { Button, Card, ConfirmButton, IconTile, StatList, StatRow, StatusChip, cx, fmt, toast, type Tone } from '../../ui';
import { resetDemo, useDB, useDBVersion } from '../../data/store';
import { WhatsAppCard } from './WhatsAppCard';

function IntCard({
  icon,
  title,
  chip,
  what,
  children,
  foot,
  wide,
  hint,
}: {
  icon: ReactNode;
  title: string;
  chip: { label: string; tone: Tone };
  what: ReactNode;
  children?: ReactNode;
  foot?: ReactNode;
  wide?: boolean;
  /** метка для подсказок режима обучения: data-hint */
  hint?: string;
}) {
  return (
    <section className={cx('card', 'set-int', wide && 'is-wide')} data-hint={hint}>
      <div className="set-int-head">
        <IconTile>{icon}</IconTile>
        <span className="set-int-title grow">{title}</span>
        <StatusChip s={chip} />
      </div>
      <div className="set-int-what">{what}</div>
      {children ? <div className="set-int-body">{children}</div> : null}
      {foot ? <div className="set-int-foot">{foot}</div> : null}
    </section>
  );
}

function Points({ label, items, icon = <Check /> }: { label: string; items: string[]; icon?: ReactNode }) {
  return (
    <div className="col" style={{ gap: 6 }}>
      <span className="set-int-label">{label}</span>
      <ul className="set-int-list">
        {items.map((x) => (
          <li key={x}>
            {icon}
            <span>{x}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function IntegrationsPage() {
  const db = useDB();
  const version = useDBVersion();
  const navigate = useNavigate();
  const today = db.meta.today;

  const d = useMemo(() => {
    let sales30 = 0;
    let refunds30 = 0;
    for (const r of db.receipts) {
      if (fmt.daysBetween(r.at, today) >= 30) continue;
      if (r.kind === 'sale') sales30++;
      else refunds30++;
    }
    let pending = 0;
    let pendingSum = 0;
    let unknown = 0;
    let unknownSum = 0;
    for (const p of db.payments) {
      if (p.status === 'pending') {
        pending++;
        pendingSum += p.amount;
      } else if (p.status === 'unidentified') {
        unknown++;
        unknownSum += p.amount;
      }
    }
    return { sales30, refunds30, pending, pendingSum, unknown, unknownSum };
  }, [db, version, today]);


  return (
    <div className="set-page">
      <PageHeader section="settings" />

      <div className="set-integrations">
        <WhatsAppCard />
        <div className="set-int-col">
          <IntCard
            icon={<ScanBarcode />}
            title="Касса и ККТ"
            hint="settings.kkt"
            chip={{ label: 'Не подключена', tone: 'warn' }}
            what="Чеки печатаются из программы, но не фискальные: в налоговую они не уходят."
            foot={<Button onClick={() => navigate('/register')}>Открыть кассу</Button>}
          >
            <StatList>
              <StatRow label="Чеков за 30 дней" value={fmt.num(d.sales30)} />
              <StatRow label="Возвратов по чекам за 30 дней" value={fmt.num(d.refunds30)} />
            </StatList>
            <Points
              label="После подключения"
              items={['Чек уходит в налоговую через ОФД сразу при оплате', 'Покупатель получает чек на телефон или почту', 'Возврат — чеком возврата, смена закрывается Z-отчётом']}
            />
          </IntCard>

        </div>
        <div className="set-int-col">
          <IntCard
            icon={<Landmark />}
            title="Банк"
            hint="settings.bank"
            chip={{ label: 'Вручную', tone: 'neutral' }}
            what="Переводы бухгалтер подтверждает по выписке банка. Пока перевод не подтверждён, долг клиента не закрыт."
            foot={<Button onClick={() => navigate('/money')}>Открыть журнал денег</Button>}
          >
            <StatList>
              <StatRow label="Переводы ждут подтверждения" value={d.pending ? `${fmt.count(d.pending, 'перевод', 'перевода', 'переводов')} на ${fmt.money(d.pendingSum)}` : 'нет'} />
              <StatRow label="Неопознанные поступления" value={d.unknown ? `${fmt.count(d.unknown, 'платёж', 'платежа', 'платежей')} на ${fmt.money(d.unknownSum)}` : 'нет'} />
            </StatList>
            <Points label="Можно добавить" icon={<Clock />} items={['Загрузку выписки файлом: программа сама найдёт оплату по сумме и ИНН плательщика']} />
          </IntCard>

          <IntCard hint="settings.1c" icon={<Layers />} title="1С" chip={{ label: 'Не используется', tone: 'neutral' }} what="У магазина нет 1С: товары, остатки, заказы и деньги учитываются здесь.">
            <StatList>
              <StatRow label="Где ведётся учёт" value="В этой программе" />
              <StatRow label="Обмен с 1С" value="Не настроен" />
            </StatList>
            <Points
              label="Если понадобится бухгалтерия в 1С"
              icon={<Clock />}
              items={[
                'Выгрузка продаж, оплат и документов в 1С:Бухгалтерию раз в день',
                'Остатки и цены ведутся только здесь — двух разных учётов не будет',
                'Журнал обмена и экран ошибок по каждой выгрузке',
              ]}
            />
          </IntCard>
        </div>
        <IntCard
          wide
          icon={<HardDrive />}
          title="Резервная копия"
          hint="settings.backup"
          chip={{ label: 'В этом браузере', tone: 'info' }}
          what="Все записи хранятся в этом браузере на этом компьютере. Если очистить данные браузера, изменения пропадут."
          foot={
            <ConfirmButton
              data-hint="settings.reset"
              icon={<RotateCcw />}
              confirmText="Стереть все изменения и вернуть исходные данные?"
              onConfirm={() => {
                resetDemo();
                toast('Данные возвращены к исходным на 5 ноября');
              }}
            >
              Вернуть исходные данные
            </ConfirmButton>
          }
        >
          <div className="grid-2" style={{ gap: 20 }}>
            <StatList>
              <StatRow label="Данные на" value={fmt.date(today, { year: true })} />
              <StatRow label="Товаров" value={fmt.num(db.products.length)} />
              <StatRow label="Заказов и чеков" value={fmt.num(db.orders.length + db.receipts.length)} />
              <StatRow label="Записей в журнале изменений" value={fmt.num(db.audit.length)} />
            </StatList>
            <Points
              label="Для настоящей работы"
              icon={<Clock />}
              items={['Копия раз в сутки на отдельный сервер, не там, где работает программа', 'Раз в месяц — проверка, что копия восстанавливается', 'Хранить копии за последние 30 дней']}
            />
          </div>
        </IntCard>
      </div>
    </div>
  );
}
