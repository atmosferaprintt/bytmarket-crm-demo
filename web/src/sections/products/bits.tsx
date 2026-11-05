/* Мелкие детали раздела «Товары»: цена со старой ценой, чипы, плитки, столбики. */
import { useState, type ReactNode } from 'react';
import { ArrowRight, Tag } from 'lucide-react';
import type { Promo } from '../../data/types';
import type { PriceInfo } from '../../data/selectors';
import { Chip, cx, fmt } from '../../ui';
import { AUDIENCE, offPct, promoValueText, type CatalogRow } from './lib';
import { StockStatusChip } from '../stock/StockStatus';

/** Цена за штуку; при акции — цена по акции и зачёркнутая обычная. */
export function PriceCell({ info, strong }: { info: PriceInfo; strong?: boolean }) {
  if (!info.promo || info.price >= info.base) return <span className={cx(strong && 'w-700')}>{fmt.price(info.base)}</span>;
  return (
    <span className="prd-price" title={`Акция «${info.promo.name}»`}>
      <span className="w-700">{fmt.price(info.price)}</span>
      <s className="prd-old">{fmt.price(info.base)}</s>
    </span>
  );
}

/** Чип остатка — тот же, что в «Складе»: только исключения, обычное «в наличии» пустое. */
export function StockChip({ row }: { row: CatalogRow }) {
  return <StockStatusChip line={row.line} />;
}

/** Число штук: ноль — красным, чтобы «нет» было видно без чипа. */
export function Qty({ v, strong }: { v: number; strong?: boolean }) {
  if (v <= 0) return <span className={cx('c-bad', strong && 'w-700')}>0</span>;
  return <span className={cx(strong && 'w-700')}>{fmt.num(v)}</span>;
}

/** Чип акции: «Акция −15 %». */
export function PromoChip({ promo, short }: { promo: Promo; short?: boolean }) {
  const audience = promo.audience === 'all' ? '' : ` · ${AUDIENCE[promo.audience].toLowerCase()}`;
  return (
    <Chip tone="green" icon={<Tag />} title={`Акция «${promo.name}» до ${fmt.date(promo.end)}${audience}`}>
      {short ? promoValueText(promo) : `Акция ${promoValueText(promo)}`}
    </Chip>
  );
}

/** Чип акции по цене роли: процент от её обычной цены. Для опта это честнее, чем «цена 169 ₽» из розничной акции. */
export function PromoPriceChip({ info }: { info: PriceInfo }) {
  if (!info.promo || info.price >= info.base) return null;
  return (
    <Chip tone="green" icon={<Tag />} title={`Акция «${info.promo.name}» до ${fmt.date(info.promo.end)}`}>
      Акция −{offPct(info)}&nbsp;%
    </Chip>
  );
}

/** Блок с заголовком внутри карточки или панели. */
export function Block({ title, actions, children, className }: { title: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('prd-block', className)}>
      <div className="prd-block-head">
        <h3 className="prd-block-title">{title}</h3>
        {actions ? <div className="row">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Ряд плиток «подпись — число». */
export function Tiles({ items }: { items: { label: ReactNode; value: ReactNode; title?: string }[] }) {
  return (
    <div className="prd-tiles" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((t, i) => (
        <div key={i} className="prd-tile" title={t.title}>
          <div className="prd-tile-label">{t.label}</div>
          <div className="prd-tile-value">{t.value}</div>
        </div>
      ))}
    </div>
  );
}

/** Было и стало: две цены и стрелка между ними. */
export function FromTo({ from, to, format = fmt.price }: { from: number; to: number; format?: (v: number) => string }) {
  if (from === to) return <span className="muted">{format(to)}</span>;
  return (
    <span className="prd-fromto">
      <span className="muted">{format(from)}</span>
      <ArrowRight aria-hidden="true" />
      <span className="w-700">{format(to)}</span>
    </span>
  );
}

export interface BarDatum {
  key: string;
  axis: string; // подпись под столбиком
  tip: string; // период в подсказке
  value: number;
}

/** Столбики по неделям: одна величина, подсказка при наведении. */
export function Bars({ data, format, label }: { data: BarDatum[]; format: (v: number) => string; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="prd-bars" role="img" aria-label={label}>
      <div className="prd-bars-plot">
        {data.map((d, i) => {
          const h = d.value > 0 ? Math.max(3, (d.value / max) * 100) : 0;
          return (
            <div key={d.key} className={cx('prd-bar-slot', hover === i && 'is-hover')} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <div className="prd-bar" style={{ height: `${h}%` }} />
              {hover === i ? (
                <div className={cx('prd-bar-tip', i > data.length - 4 && 'is-left')} style={{ bottom: `calc(${Math.min(h, 60)}% + 8px)` }}>
                  <div className="w-700">{format(d.value)}</div>
                  <div className="muted">{d.tip}</div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="prd-bars-axis">
        {data.map((d) => (
          <span key={d.key}>{d.axis}</span>
        ))}
      </div>
    </div>
  );
}
