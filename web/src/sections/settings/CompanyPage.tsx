import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../shell/PageHeader';
import { Button, Card, Chip, Field, Input, MoneyInput, fmt, toast } from '../../ui';
import { dispatch, useDB, useDBVersion } from '../../data/store';
import type { RoleKey, Settings } from '../../data/types';
import { isInn } from '../../data/codes';
import { ROLES, ROLE_ORDER } from '../../roles/roles';
import { useSession } from '../../roles/session';
import { roleSells } from './perms';

type Company = Settings['company'];

interface Form {
  company: Company;
  limits: Record<RoleKey, string>;
  minMarginPct: string;
  defaultDeferDays: string;
  deliveryFee: number | '';
  freeDeliveryFrom: number | '';
}

function toForm(s: Settings): Form {
  return {
    company: { ...s.company },
    limits: Object.fromEntries(ROLE_ORDER.map((r) => [r, String(s.discountLimits[r] ?? 0)])) as Record<RoleKey, string>,
    minMarginPct: String(s.minMarginPct),
    defaultDeferDays: String(s.defaultDeferDays),
    deliveryFee: s.deliveryFee,
    freeDeliveryFrom: s.freeDeliveryFrom,
  };
}

const COMPANY_FIELDS: { key: keyof Company; label: string; wide?: boolean; placeholder?: string }[] = [
  { key: 'name', label: 'Название магазина' },
  { key: 'legalName', label: 'Юрлицо', placeholder: 'ООО «…» или ИП …' },
  { key: 'inn', label: 'ИНН', placeholder: '10 или 12 цифр' },
  { key: 'phone', label: 'Телефон' },
  { key: 'address', label: 'Адрес', wide: true },
  { key: 'bank', label: 'Банк', wide: true, placeholder: 'Название банка и БИК' },
  { key: 'account', label: 'Расчётный счёт', placeholder: '20 цифр' },
];

const int = (s: string): number | null => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);

function validate(f: Form): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.company.name.trim()) e.name = 'Укажите название — оно стоит в шапке счёта';
  const inn = f.company.inn.trim();
  if (inn && !isInn(inn)) e.inn = 'ИНН не сходится: проверьте цифры';
  const acc = f.company.account.replace(/\s/g, '');
  if (acc && !/^\d{20}$/.test(acc)) e.account = 'Расчётный счёт — 20 цифр';
  for (const r of ROLE_ORDER) {
    const v = int(f.limits[r]);
    if (v === null || v > 100) e['limit-' + r] = 'От 0 до 100 %';
  }
  const m = int(f.minMarginPct);
  if (m === null || m > 300) e.minMarginPct = 'От 0 до 300 %';
  const d = int(f.defaultDeferDays);
  if (d === null || d > 180) e.defaultDeferDays = 'От 0 до 180 дней';
  if (f.deliveryFee === '') e.deliveryFee = 'Укажите сумму, 0 — бесплатно';
  if (f.freeDeliveryFrom === '') e.freeDeliveryFrom = 'Укажите сумму, 0 — всегда бесплатно';
  return e;
}

function toPatch(f: Form) {
  return {
    company: Object.fromEntries(Object.entries(f.company).map(([k, v]) => [k, k === 'account' ? v.replace(/\s/g, '') : v.trim()])) as Company,
    discountLimits: Object.fromEntries(ROLE_ORDER.map((r) => [r, int(f.limits[r]) ?? 0])) as Record<RoleKey, number>,
    minMarginPct: int(f.minMarginPct) ?? 0,
    defaultDeferDays: int(f.defaultDeferDays) ?? 0,
    deliveryFee: f.deliveryFee === '' ? 0 : f.deliveryFee,
    freeDeliveryFrom: f.freeDeliveryFrom === '' ? 0 : f.freeDeliveryFrom,
  };
}

function samePatch(a: ReturnType<typeof toPatch>, s: Settings): boolean {
  const keys = Object.keys(s.company) as (keyof Company)[];
  if (keys.some((k) => a.company[k] !== s.company[k])) return false;
  if (ROLE_ORDER.some((r) => a.discountLimits[r] !== (s.discountLimits[r] ?? 0))) return false;
  return a.minMarginPct === s.minMarginPct && a.defaultDeferDays === s.defaultDeferDays && a.deliveryFee === s.deliveryFee && a.freeDeliveryFrom === s.freeDeliveryFrom;
}

/** Целое число с подписью справа: «5 %», «14 дн.» */
function NumField({ value, onChange, suffix, invalid, ariaLabel }: { value: string; onChange: (v: string) => void; suffix: string; invalid?: boolean; ariaLabel: string }) {
  return (
    <Input
      aria-label={ariaLabel}
      className="set-num-input num"
      inputMode="numeric"
      value={value}
      invalid={invalid}
      suffix={suffix}
      style={{ paddingRight: 44 }}
      onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
    />
  );
}

function RuleRow({ label, children, error }: { label: ReactNode; children: ReactNode; error?: string }) {
  return (
    <div className="set-rule-row">
      <span className="set-rule-label">{label}</span>
      {children}
      {error ? <span className="set-rule-error">{error}</span> : null}
    </div>
  );
}

export function CompanyPage() {
  const db = useDB();
  const version = useDBVersion();
  const { me } = useSession();
  const navigate = useNavigate();
  const [form, setForm] = useState<Form>(() => toForm(db.settings));
  const [showErrors, setShowErrors] = useState(false);

  // если настройки изменились в другом месте (например, начали заново) — подтянуть
  useEffect(() => {
    setForm(toForm(db.settings));
    setShowErrors(false);
  }, [db.settings]);

  const errors = validate(form);
  const patch = toPatch(form);
  const dirty = !samePatch(patch, db.settings);
  const hasErrors = Object.keys(errors).length > 0;
  const err = (k: string) => (showErrors || k.startsWith('limit-') || ['minMarginPct', 'defaultDeferDays'].includes(k) ? errors[k] : undefined);

  const setCompany = (k: keyof Company, v: string) => setForm((f) => ({ ...f, company: { ...f.company, [k]: v } }));

  const lastChange = useMemo(() => {
    for (let i = db.audit.length - 1; i >= 0; i--) if (db.audit[i].entity === 'settings') return db.audit[i];
    return null;
  }, [db, version]);
  const lastAuthor = lastChange ? db.employees.find((e) => e.id === lastChange.actorId) : undefined;

  // сколько товаров уже продаётся оптом ниже введённой наценки — видно сразу при вводе
  const marginNow = int(form.minMarginPct);
  const belowMargin = useMemo(() => {
    if (marginNow === null) return null;
    let n = 0;
    for (const p of db.products) if (p.active && p.cost !== null && p.wholesalePrice < Math.ceil((p.cost * (100 + marginNow)) / 100)) n++;
    return n;
  }, [db, version, marginNow]);

  const docSample = useMemo(() => {
    let maxNo = 0;
    for (const o of db.orders) if (o.number > maxNo) maxNo = o.number;
    const buyer = db.clients.find((c) => c.active && c.kind === 'ooo' && c.inn) ?? db.clients.find((c) => c.inn);
    return { number: maxNo + 1, buyer };
  }, [db, version]);

  const save = () => {
    if (hasErrors) {
      setShowErrors(true);
      toast('Проверьте поля, отмеченные красным', 'error');
      return;
    }
    const r = dispatch('settings.update', { patch }, me.id);
    if (!r.ok) {
      toast(r.error, 'error');
      return;
    }
    toast('Настройки сохранены');
  };

  const sellRoles = ROLE_ORDER.filter(roleSells);
  const quietRoles = ROLE_ORDER.filter((r) => !roleSells(r)).map((r) => ROLES[r].short.toLowerCase());

  const c = form.company;
  const docValue = (v: string, fallback = 'не заполнено') => (v.trim() ? <span>{v}</span> : <span className="set-doc-empty">{fallback}</span>);

  return (
    <div className="set-page">
      <PageHeader
        section="settings"
        actions={
          <>
            {dirty ? (
              <Button variant="ghost" onClick={() => setForm(toForm(db.settings))}>
                Отменить изменения
              </Button>
            ) : null}
            <Button variant="primary" disabled={!dirty} onClick={save}>
              Сохранить
            </Button>
          </>
        }
      />

      <div className="set-company">
        <div className="col-4" style={{ gap: 20 }}>
          <Card title="Реквизиты" sub="Попадают в счета, накладные и акты сверки">
            <div className="set-form">
              {COMPANY_FIELDS.map((f) => (
                <Field key={f.key} label={f.label} error={err(f.key)} className={f.wide ? 'is-wide' : undefined}>
                  <Input value={c[f.key]} placeholder={f.placeholder} invalid={!!err(f.key)} onChange={(e) => setCompany(f.key, e.target.value)} />
                </Field>
              ))}
            </div>
          </Card>

          <Card title="Так видит клиент в счёте">
            <div className="set-doc">
              <div className="set-doc-title">
                Счёт на оплату № {fmt.num(docSample.number)} от {fmt.date(db.meta.today, { year: true })}
              </div>
              <div className="set-doc-row">
                <span>Поставщик</span>
                {docValue(c.legalName)}
              </div>
              <div className="set-doc-row">
                <span>ИНН</span>
                {docValue(c.inn)}
              </div>
              <div className="set-doc-row">
                <span>Адрес</span>
                {docValue(c.address)}
              </div>
              <div className="set-doc-row">
                <span>Телефон</span>
                {c.phone.trim() ? <span>{fmt.phone(c.phone)}</span> : <span className="set-doc-empty">не заполнено</span>}
              </div>
              <div className="set-doc-row">
                <span>Банк</span>
                {docValue(c.bank)}
              </div>
              <div className="set-doc-row">
                <span>Расчётный счёт</span>
                {docValue(c.account)}
              </div>
              {docSample.buyer ? (
                <div className="set-doc-row">
                  <span>Покупатель</span>
                  <span>
                    {docSample.buyer.name}
                    {docSample.buyer.inn ? `, ИНН ${docSample.buyer.inn}` : ''}
                  </span>
                </div>
              ) : null}
            </div>
          </Card>
        </div>

        <Card title="Правила продаж" sub={lastChange ? `Последнее изменение: ${fmt.dateTime(lastChange.at)}${lastAuthor ? `, ${lastAuthor.short}` : ''}` : undefined}>
          <div className="set-rules">
            <div className="set-rule-group">
              <div className="set-rule-title">Ручная скидка, не больше</div>
              {sellRoles.map((r) => (
                <RuleRow key={r} label={ROLES[r].name} error={err('limit-' + r)}>
                  <NumField
                    ariaLabel={`Лимит скидки: ${ROLES[r].name}`}
                    value={form.limits[r]}
                    suffix="%"
                    invalid={!!err('limit-' + r)}
                    onChange={(v) => setForm((f) => ({ ...f, limits: { ...f.limits, [r]: v } }))}
                  />
                </RuleRow>
              ))}
              {quietRoles.length ? <div className="t-12 muted">Не продают и скидку не дают: {quietRoles.join(', ')}.</div> : null}
            </div>

            <div className="set-rule-group">
              <div className="set-rule-title">Наценка и отсрочка</div>
              <RuleRow label={<span title="Цена продажи не ниже себестоимости плюс этот процент. Ниже — программа предупредит">Минимальная наценка</span>} error={err('minMarginPct')}>
                <NumField ariaLabel="Минимальная наценка" value={form.minMarginPct} suffix="%" invalid={!!err('minMarginPct')} onChange={(v) => setForm((f) => ({ ...f, minMarginPct: v }))} />
              </RuleRow>
              {belowMargin !== null ? (
                <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                  <Chip tone={belowMargin > 0 ? 'warn' : 'ok'}>{belowMargin > 0 ? `Опт ниже наценки: ${fmt.count(belowMargin, 'товар', 'товара', 'товаров')}` : 'Все оптовые цены выше наценки'}</Chip>
                  {belowMargin > 0 ? (
                    <button type="button" className="link-button t-13" onClick={() => navigate('/products/pricing')}>
                      Открыть цены
                    </button>
                  ) : null}
                </div>
              ) : null}
              <RuleRow label="Отсрочка для новых оптовых клиентов" error={err('defaultDeferDays')}>
                <NumField
                  ariaLabel="Отсрочка по умолчанию"
                  value={form.defaultDeferDays}
                  suffix="дн."
                  invalid={!!err('defaultDeferDays')}
                  onChange={(v) => setForm((f) => ({ ...f, defaultDeferDays: v }))}
                />
              </RuleRow>
            </div>

            <div className="set-rule-group">
              <div className="set-rule-title">Доставка</div>
              <div className="set-rule-pair">
                <Field label="Стоимость для клиента" error={err('deliveryFee')}>
                  <MoneyInput value={form.deliveryFee} onChange={(v) => setForm((f) => ({ ...f, deliveryFee: v }))} invalid={!!err('deliveryFee')} />
                </Field>
                <Field label="Бесплатно от суммы заказа" error={err('freeDeliveryFrom')}>
                  <MoneyInput value={form.freeDeliveryFrom} onChange={(v) => setForm((f) => ({ ...f, freeDeliveryFrom: v }))} invalid={!!err('freeDeliveryFrom')} />
                </Field>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
