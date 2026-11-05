/* Смена розничной и оптовой цены: «было — стало», наценка, проверка минимальной наценки. */
import { useState } from 'react';
import { Tag } from 'lucide-react';
import { priceFor } from '../../data/selectors';
import type { Product } from '../../data/types';
import { dispatch, useDB } from '../../data/store';
import { useSession } from '../../roles/session';
import { Button, Field, Modal, MoneyInput, Notice, fmt, toast } from '../../ui';
import { FromTo } from './bits';
import { markupPct, minAllowedPrice, pct1, promoPrice } from './lib';

export default function PriceModal({ product, onClose, onSaved }: { product: Product; onClose: () => void; onSaved?: () => void }) {
  const db = useDB();
  const { me, can } = useSession();
  const seeCost = can('seeCost');
  const [retail, setRetail] = useState<number | ''>(product.retailPrice);
  const [wholesale, setWholesale] = useState<number | ''>(product.wholesalePrice);
  const [error, setError] = useState<string | null>(null);

  const r = retail === '' ? 0 : retail;
  const w = wholesale === '' ? 0 : wholesale;
  const cost = product.cost;
  const minPrice = minAllowedPrice(cost, db.settings.minMarginPct);
  const changed = r !== product.retailPrice || w !== product.wholesalePrice;
  const wholesaleHigh = w > r;
  const below = minPrice !== null && (w < minPrice || r < minPrice);

  // акция на товар: покупатели платят акционную цену, пока она действует
  const today = db.meta.today;
  const pr = priceFor(db, product.id, { priceType: 'retail', date: today });
  const pw = priceFor(db, product.id, { priceType: 'wholesale', date: today });
  const promo = pr.promo && pr.price < pr.base ? pr.promo : pw.promo && pw.price < pw.base ? pw.promo : null;
  /** Цена по акции после изменения: процент считается от новой цены, фиксированная цена акции остаётся. */
  const promoAfter = (info: typeof pr, base: number) => {
    if (!info.promo || info.price >= info.base) return null;
    if (info.promo.audience !== 'all' && info.promo.audience !== (info === pr ? 'retail' : 'wholesale')) return info.price; // опт по розничной акции
    return promoPrice(info.promo, base);
  };
  const retailPromoAfter = promoAfter(pr, r);
  const wholesalePromoAfter = promoAfter(pw, w);

  const save = () => {
    setError(null);
    if (!r || !w) return setError('Укажите обе цены');
    if (wholesaleHigh) return setError('Оптовая цена выше розничной. Опт должен быть не дороже розницы');
    if (!changed) return setError('Цены не изменились');
    const res = dispatch('price.set', { productId: product.id, retailPrice: r, wholesalePrice: w }, me.id);
    if (!res.ok) return setError(res.error);
    toast('Цена изменена. Проведённые чеки и заказы не меняются');
    onSaved?.();
    onClose();
  };

  const row = (label: string, from: number, to: number) => (
    <div className="prd-price-row">
      <span className="muted">{label}</span>
      <FromTo from={from} to={to} />
      {seeCost && cost !== null ? (
        <span className="prd-price-markup">
          <FromTo from={Math.round(markupPct(from, cost)! * 10) / 10} to={Math.round(markupPct(to || 0, cost)! * 10) / 10} format={(v) => pct1(v)} />
        </span>
      ) : null}
    </div>
  );

  return (
    <Modal
      title="Изменить цену"
      sub={product.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={save} disabled={!changed}>
            Сохранить цену
          </Button>
        </>
      }
    >
      <div className="prd-form-grid-2">
        <Field label="Розница за штуку">
          <MoneyInput autoFocus value={retail} onChange={setRetail} invalid={!r} />
        </Field>
        <Field label="Опт за штуку" error={wholesaleHigh ? 'Дороже розницы' : undefined}>
          <MoneyInput value={wholesale} onChange={setWholesale} invalid={wholesaleHigh || !w} />
        </Field>
      </div>
      <div className="prd-price-compare">
        <div className="prd-price-row t-12 muted w-600">
          <span />
          <span>Было и стало</span>
          {seeCost && cost !== null ? <span className="prd-price-markup">Наценка</span> : null}
        </div>
        {row('Розница', product.retailPrice, r)}
        {row('Опт', product.wholesalePrice, w)}
        {seeCost ? (
          <div className="prd-price-row">
            <span className="muted">Себестоимость</span>
            <span>{cost === null ? 'не известна' : fmt.price(cost)}</span>
          </div>
        ) : null}
      </div>
      {promo ? (
        <Notice tone="info" title={`Действует акция «${promo.name}» до ${fmt.date(promo.end)}`}>
          <div className="prd-promo-now">
            <Tag aria-hidden="true" />
            <span>
              {[
                pr.promo && pr.price < pr.base ? { label: 'Розница по акции', now: pr.price, after: retailPromoAfter } : null,
                pw.promo && pw.price < pw.base ? { label: 'Опт по акции', now: pw.price, after: wholesalePromoAfter } : null,
              ]
                .filter((x): x is { label: string; now: number; after: number | null } => !!x)
                .map((x, i) => (
                  <span key={x.label}>
                    {i ? '; ' : ''}
                    {i ? x.label.toLowerCase() : x.label} <b className="num">{fmt.price(x.now)}</b>
                    {x.after !== null && x.after !== x.now ? (
                      <>
                        , станет <b className="num">{fmt.price(x.after)}</b>
                      </>
                    ) : null}
                  </span>
                ))}
              .{' '}
              {promo.kind === 'percent'
                ? 'Скидка акции считается от новой цены.'
                : `Пока идёт акция, покупатели платят цену акции; новая цена начнёт действовать после ${fmt.date(promo.end)}.`}
            </span>
          </div>
        </Notice>
      ) : null}
      {seeCost && below ? (
        <Notice tone="warn">
          {r < minPrice! && w < minPrice! ? 'Обе цены' : r < minPrice! ? 'Розничная цена' : 'Оптовая цена'} ниже себестоимости плюс {db.settings.minMarginPct}&nbsp;%. Наименьшая допустимая — {fmt.price(minPrice)}.
        </Notice>
      ) : null}
      <Notice tone="info">Новая цена действует для новых чеков и заказов. Проведённые документы остаются по старой цене.</Notice>
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Modal>
  );
}
