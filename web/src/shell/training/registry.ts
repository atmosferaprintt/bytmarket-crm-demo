/* Все подсказки режима обучения: общие (шапка, меню, таблицы, окна) и разделов. */
import type { HintDef } from './types';
import { shellHints } from './shellHints';
import { hints as overview } from '../../sections/overview/hints';
import { hints as register } from '../../sections/register/hints';
import { hints as sales } from '../../sections/sales/hints';
import { hints as clients } from '../../sections/clients/hints';
import { hints as delivery } from '../../sections/delivery/hints';
import { hints as products } from '../../sections/products/hints';
import { hints as stock } from '../../sections/stock/hints';
import { hints as purchases } from '../../sections/purchases/hints';
import { hints as money } from '../../sections/money/hints';
import { hints as reports } from '../../sections/reports/hints';
import { hints as settings } from '../../sections/settings/hints';

export const HINTS: HintDef[] = [...overview, ...register, ...sales, ...clients, ...delivery, ...products, ...stock, ...purchases, ...money, ...reports, ...settings, ...shellHints];
