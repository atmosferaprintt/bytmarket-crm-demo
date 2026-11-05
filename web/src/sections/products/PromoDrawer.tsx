/* Карточка акции в боковой панели: условия, товары с ценой по акции, продажи, включить / выключить. */
import { useMemo } from 'react';
import { dispatch, useDB, useDBVersion } from '../../data/store';
import { indexes } from '../../data/selectors';
import { useSession } from '../../roles/session';
import { EntityLink } from '../../shell/entities';
import { Button, Chip, ConfirmButton, Drawer, EmptyState, StatusChip, fmt, toast } from '../../ui';
import { AUDIENCE, PROMO_STATE, markupPct, pct1, minAllowedPrice, promoPrice, promoProducts, promoSales, promoState, promoTargetText, promoValueText } from './lib';
import { Block, Tiles } from './bits';

export default function PromoDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const db = useDB();
  const version = useDBVersion();
  const { me, can } = useSession();
  const seeCost = can('seeCost');
  const pr = db.promos.find((x) => x.id === id);
  const products = useMemo(() => (pr ? promoProducts(db, pr.target, pr.audience) : []), [db, version, pr]);
  if (!pr)
    return (
      <Drawer title="Акция" onClose={onClose}>
        <EmptyState title="Акция не найдена" />
      </Drawer>
    );
  const st = promoState(pr, db.meta.today);
  const sold = promoSales(db).get(pr.id) ?? { qty: 0, sum: 0 };
  const author = indexes(db).employees.get(pr.createdBy)?.name ?? '—';
  const priceType = pr.audience === 'wholesale' ? 'wholesale' : 'retail';
  const minPct = db.settings.minMarginPct;

  const toggle = (active: boolean) => {
    const r = dispatch('promo.toggle', { promoId: pr.id, active }, me.id);
    if (!r.ok) return toast(r.error, 'error');
    toast(active ? 'Акция включена' : 'Акция выключена');
  };

  return (
    <Drawer
      title={pr.name}
      sub={`${promoTargetText(db, pr)} · ${AUDIENCE[pr.audience].toLowerCase()} · ${fmt.date(pr.start)} — ${fmt.date(pr.end)}`}
      onClose={onClose}
      head={
        <div className="prd-chips">
          <StatusChip s={PROMO_STATE[st]} />
          <Chip tone="green">{promoValueText(pr)}</Chip>
        </div>
      }
      footer={
        can('promos') ? (
          <>
            {pr.active ? (
              <ConfirmButton onConfirm={() => toggle(false)} confirmText="Выключить акцию?">
                Выключить акцию
              </ConfirmButton>
            ) : (
              <Button onClick={() => toggle(true)}>Включить акцию</Button>
            )}
            <span className="spacer" />
            <span className="muted t-12">Создал {author}</span>
          </>
        ) : null
      }
    >
      <Block title="Условия">
        <Tiles
          items={[
            { label: 'Скидка', value: promoValueText(pr) },
            { label: 'Товаров', value: fmt.num(products.length) },
            { label: 'Продано', value: fmt.qty(sold.qty) },
            { label: 'Выручка', value: fmt.moneyShort(sold.sum) },
          ]}
        />
      </Block>
      <Block title={`Товары, цена ${pr.audience === 'wholesale' ? 'опт' : 'розница'}`}>
        {products.length ? (
          <div className="table-scroll prd-inner-table">
            <table className="table table-dense">
              <thead>
                <tr>
                  <th>Товар</th>
                  <th className="num">Обычная</th>
                  <th className="num">По акции</th>
                  {seeCost ? <th className="num">Наценка</th> : null}
                </tr>
              </thead>
              <tbody>
                {products.slice(0, 80).map((p) => {
                  const base = priceType === 'wholesale' ? p.wholesalePrice : p.retailPrice;
                  const price = promoPrice(pr, base);
                  const m = markupPct(price, p.cost);
                  const min = minAllowedPrice(p.cost, minPct);
                  const low = min !== null && price < min;
                  return (
                    <tr key={p.id}>
                      <td className="prd-buyer">
                        <EntityLink type="product" id={p.id}>
                          {p.name}
                        </EntityLink>
                      </td>
                      <td className="num muted">{fmt.price(base)}</td>
                      <td className="num w-700">{fmt.price(price)}</td>
                      {seeCost ? (
                        <td className="num nowrap">
                          {low ? (
                            <Chip tone="warn" title={`Нужно не меньше ${fmt.price(min)}`}>
                              {pct1(m)}
                            </Chip>
                          ) : (
                            pct1(m)
                          )}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {products.length > 80 ? <div className="table-foot">Показано 80 из {fmt.num(products.length)}</div> : null}
          </div>
        ) : (
          <div className="muted">Под условия акции товаров нет</div>
        )}
      </Block>
    </Drawer>
  );
}
