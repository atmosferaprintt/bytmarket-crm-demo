/* Доступ раздела к расчётам слоя данных. Только чтение. */
import type { DB, ID } from '../../data/types';
import { repeatPreview, type RepeatPreviewResult } from '../../data/ops';

export {
  clientBalance,
  clientBalances,
  indexes,
  orderPayment,
  orderReturns,
  priceFor,
  salesForPeriod,
  stockIndex,
  stockOf,
  type ClientBalance,
  type OrderPayment,
} from '../../data/selectors';
export type { RepeatPreviewResult, RepeatLine } from '../../data/ops';

/** Повтор заказа без исключения: null, если заказ не найден. */
export function repeatPreviewSafe(db: DB, orderId: ID): RepeatPreviewResult | null {
  try {
    return repeatPreview(db, orderId);
  } catch {
    return null;
  }
}
