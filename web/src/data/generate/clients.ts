/* Клиенты: магазины у дома, кафе и гостиницы, клининг, рынки, розничные покупатели.
   У каждого оптового — ответственный, точки по районам Астрахани, отсрочка, лимит и привычный ассортимент. */
import type { Client, ClientContact, ClientPoint, ClientSegment, DB, ID, ISODate, PackKey } from '../types';
import type { Rng } from '../rng';
import { makeInn10, makeInn12 } from '../codes';
import type { ProdMeta } from './catalog';
import { E, MANAGERS, TARASOV_START } from './org';
import {
  CLEANING,
  CLIENT_NOTES,
  CONTACT_ROLES_ORG,
  CONTACT_ROLES_SHOP,
  DISTRICTS,
  FEMALE_FIRST,
  FEMALE_PATRONYMIC,
  HORECA,
  MALE_FIRST,
  MALE_PATRONYMIC,
  MARKETS,
  RETAIL_CARD_PREFIX,
  SHOP_CHAINS,
  SHOP_NAMES,
  SURNAMES,
  femaleSurname,
} from './names';

export interface AssortItem {
  pi: number; // индекс товара
  pack: PackKey;
  packQty: number;
}

export type Discipline = 'good' | 'late' | 'bad';

export interface ClientMeta {
  id: ID;
  seg: ClientSegment;
  owner: ID; // ответственный на конец периода
  startOwner: ID; // ответственный в начале (до выхода Тарасова)
  cadence: number;
  discipline: Discipline;
  assortment: AssortItem[];
  pickQ: number; // доля ассортимента в одном заказе
  payMethod: 'cash' | 'card' | 'transfer';
  delivery: number; // склонность к доставке
  createdAt: ISODate; // для новых — дата появления
  isNew: boolean;
  tight: boolean; // лимит впритык: владелец подтверждает сверх лимита
  avgOrder: number;
  client: Client; // для новых — данные для client.create
}

const PHONE_CODES = ['917', '927', '937', '961', '988', '906', '905', '960'];

function phone(rng: Rng): string {
  return '+79' + rng.pick(PHONE_CODES).slice(1) + String(rng.int(1000000, 9999999));
}

function person(rng: Rng, female: boolean): { first: string; last: string; patr: string } {
  const last = rng.pick(SURNAMES);
  return female
    ? { first: rng.pick(FEMALE_FIRST), last: femaleSurname(last), patr: rng.pick(FEMALE_PATRONYMIC) }
    : { first: rng.pick(MALE_FIRST), last, patr: rng.pick(MALE_PATRONYMIC) };
}

const NAMES_GEN = new Set(['Николая']);

function streetOn(street: string): string {
  if (street.startsWith('пр. Губернатора')) return 'Гужвина';
  if (street === 'Аэропортовское шоссе') return 'Аэропортовском шоссе';
  const s = street.replace(/^ул\. /, '');
  return s
    .split(' ')
    // склоняются только прилагательные: «Красная Набережная» → «Красной Набережной»; «Николая Островского» — как есть
    .map((w) => (w.endsWith('ая') && !NAMES_GEN.has(w) ? w.slice(0, -2) + 'ой' : w === '3-я' ? '3-й' : w))
    .join(' ');
}

function point(rng: Rng, n: () => string, shopName: string, districtIdx: number): ClientPoint {
  const d = DISTRICTS[districtIdx];
  const street = rng.pick(d.streets);
  const house = rng.chance(0.15) ? `${rng.int(1, 60)}, корп. ${rng.int(1, 3)}` : String(rng.int(1, 160));
  return {
    id: n(),
    name: `«${shopName}» на ${streetOn(street)}`,
    address: `${street}, ${house}`,
    district: d.name,
    lat: Math.round((d.lat + rng.float(-d.dLat, d.dLat)) * 1e5) / 1e5,
    lng: Math.round((d.lng + rng.float(-d.dLng, d.dLng)) * 1e5) / 1e5,
  };
}

const SEG_SUBS: Record<Exclude<ClientSegment, 'retail'>, Record<string, number>> = {
  shop: {},
  horeca: {
    'cat-dishes-liquid': 3, 'cat-dishes-pmm': 2, 'cat-clean-universal': 2, 'cat-clean-floor': 2, 'cat-clean-kitchen': 2, 'cat-clean-glass': 1,
    'cat-san-gel': 2, 'cat-san-wc': 1, 'cat-san-pipes': 0.5, 'cat-hyg-liquid': 2, 'cat-paper-toilet': 2, 'cat-paper-towels': 2, 'cat-paper-napkins': 2,
    'cat-bags-trash': 2, 'cat-bags-food': 1.5, 'cat-sp-sponges': 2, 'cat-sp-micro': 1, 'cat-sp-gloves': 1.5, 'cat-kit-foil': 1.5, 'cat-kit-film': 1.5,
    'cat-kit-paper': 1.5, 'cat-air-spray': 0.5,
  },
  cleaning: {
    'cat-clean-universal': 3, 'cat-clean-glass': 3, 'cat-clean-floor': 3, 'cat-clean-kitchen': 3, 'cat-san-gel': 2.5, 'cat-san-powder': 2, 'cat-san-pipes': 1.5,
    'cat-hyg-liquid': 1.5, 'cat-bags-trash': 2.5, 'cat-sp-micro': 2.5, 'cat-sp-floor': 2, 'cat-sp-gloves': 2.5, 'cat-sp-sponges': 1.5, 'cat-paper-toilet': 1.5,
    'cat-paper-towels': 1.5, 'cat-air-spray': 1,
  },
  market: {
    'cat-laundry-powder': 2.5, 'cat-laundry-gel': 1, 'cat-dishes-liquid': 2, 'cat-paper-toilet': 2, 'cat-bags-trash': 2, 'cat-bags-tshirt': 3, 'cat-bags-food': 2,
    'cat-sp-sponges': 1.5, 'cat-hyg-soap': 1.5, 'cat-hyg-household': 1.5, 'cat-san-powder': 1, 'cat-san-gel': 1, 'cat-laundry-softener': 0.8,
  },
};

function assortment(rng: Rng, db: DB, meta: ProdMeta[], seg: Exclude<ClientSegment, 'retail'>, size: number): AssortItem[] {
  const subW = SEG_SUBS[seg];
  const all = seg === 'shop';
  const cands = meta.filter((m) => m.pop > 0 && !m.inactiveFromStart && (all || subW[m.sub]));
  const w = cands.map((m) => {
    let x = m.pop * (all ? 1 : subW[m.sub]);
    if (seg === 'horeca' || seg === 'cleaning') x *= m.sizeIdx === m.sizeCount - 1 && m.sizeCount > 1 ? 2.2 : 0.8;
    if (seg === 'shop') x *= m.sizeIdx <= 1 ? 1.2 : 0.7;
    if (seg === 'market') x *= m.hot ? 2 : 1;
    return x;
  });
  const chosen = new Set<number>();
  let guard = 0;
  while (chosen.size < Math.min(size, cands.length) && guard++ < size * 30) chosen.add(rng.weighted(cands, w).index);
  return [...chosen].map((pi) => {
    const p = db.products[pi];
    const pack = p.packs.find((x) => x.key === 'pack');
    const box = p.packs.find((x) => x.key === 'box');
    if (seg === 'market') {
      if (box && box.qty <= 12) return { pi, pack: 'box' as PackKey, packQty: rng.int(1, 2) };
      if (box) return { pi, pack: 'box' as PackKey, packQty: 1 };
      if (pack) return { pi, pack: 'pack' as PackKey, packQty: rng.int(1, 3) };
      return { pi, pack: 'pcs' as PackKey, packQty: rng.int(4, 10) };
    }
    if (seg === 'shop') {
      if (pack && rng.chance(0.7)) return { pi, pack: 'pack' as PackKey, packQty: 1 };
      if (box && box.qty <= 6 && rng.chance(0.4)) return { pi, pack: 'box' as PackKey, packQty: 1 };
      if (box && box.qty <= 12 && rng.chance(0.15)) return { pi, pack: 'box' as PackKey, packQty: 1 };
      return { pi, pack: 'pcs' as PackKey, packQty: rng.pick([2, 3, 3, 4, 4, 5, 6, 6]) };
    }
    // кафе, гостиницы, клининг
    if ((p.weightG ?? 0) >= 3000) return { pi, pack: 'pcs' as PackKey, packQty: rng.int(1, 4) };
    if (pack && rng.chance(0.5)) return { pi, pack: 'pack' as PackKey, packQty: rng.int(1, 2) };
    if (box && box.qty <= 12 && rng.chance(0.3)) return { pi, pack: 'box' as PackKey, packQty: 1 };
    return { pi, pack: 'pcs' as PackKey, packQty: rng.pick([2, 2, 3, 4, 5, 6]) };
  });
}

function orderValue(db: DB, items: AssortItem[], q: number): number {
  let s = 0;
  for (const a of items) {
    const p = db.products[a.pi];
    const qty = (p.packs.find((x) => x.key === a.pack)?.qty ?? 1) * a.packQty;
    s += q * qty * p.wholesalePrice;
  }
  return s;
}

export interface ClientsResult {
  metas: ClientMeta[];
  retailIds: ID[];
}

export function buildClients(db: DB, rng: Rng, meta: ProdMeta[], startDate: ISODate): ClientsResult {
  let pointN = 0;
  let contactN = 0;
  let clientN = 0;
  const nextPoint = (): string => 'pt-' + ++pointN;
  const nextContact = (): string => 'ct-' + ++contactN;
  const metas: ClientMeta[] = [];
  const usedShopNames = new Set<string>();
  const shopName = (): string => {
    for (let i = 0; i < 200; i++) {
      const n = rng.pick(SHOP_NAMES);
      if (!usedShopNames.has(n)) {
        usedShopNames.add(n);
        return n;
      }
    }
    return 'Магазин у дома ' + usedShopNames.size;
  };
  const innFor = (kind: 'ip' | 'ooo'): string =>
    kind === 'ooo' ? makeInn10('30' + String(rng.int(1000000, 9999999))) : makeInn12('30' + String(rng.int(10000000, 99999999)));

  const contact = (roles: string[], female?: boolean): ClientContact => {
    const p = person(rng, female ?? rng.chance(0.6));
    return { id: nextContact(), name: `${p.first} ${p.last}`, role: rng.pick(roles), phone: phone(rng) };
  };

  // ---- магазины у дома (45) ----
  const districtsForShops = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3];
  const shopDefs: { chain: string | null }[] = [];
  for (let i = 0; i < 40; i++) shopDefs.push({ chain: null });
  for (let i = 0; i < 5; i++) shopDefs.push({ chain: SHOP_CHAINS[i] });

  const mk = (seg: ClientSegment, extra: Partial<ClientMeta>, client: Client): ClientMeta => ({
    id: client.id,
    seg,
    owner: client.ownerId ?? '',
    startOwner: client.ownerId ?? '',
    cadence: client.orderEveryDays ?? 14,
    discipline: 'good',
    assortment: [],
    pickQ: 0.5,
    payMethod: 'transfer',
    delivery: 0.3,
    createdAt: client.createdAt,
    isNew: false,
    tight: false,
    avgOrder: 0,
    client,
    ...extra,
  });

  const baseClient = (over: Partial<Client> & Pick<Client, 'name' | 'kind' | 'segment'>): Client => ({
    id: 'cl-' + ++clientN,
    priceType: over.segment === 'retail' ? 'retail' : 'wholesale',
    inn: null,
    phone: phone(rng),
    points: [],
    contacts: [],
    deferDays: 0,
    creditLimit: 0,
    ownerId: null,
    orderEveryDays: null,
    minOrder: 0,
    note: '',
    createdAt: `202${rng.int(3, 5)}-${String(rng.int(1, 12)).padStart(2, '0')}-${String(rng.int(1, 28)).padStart(2, '0')}`,
    active: true,
    ...over,
  });

  const deferPick = (seg: ClientSegment): number =>
    seg === 'shop'
      ? rng.weighted([0, 7, 14, 21, 30], [35, 25, 25, 10, 5])
      : seg === 'horeca'
        ? rng.weighted([14, 21, 30], [40, 30, 30])
        : seg === 'cleaning'
          ? rng.weighted([7, 14, 30], [30, 40, 30])
          : rng.weighted([0, 7], [70, 30]);

  for (const def of shopDefs) {
    const isChain = def.chain !== null;
    const kind = isChain ? 'ooo' : rng.chance(0.8) ? 'ip' : 'ooo';
    const female = rng.chance(0.6);
    const owner = person(rng, female);
    const brandName = isChain ? def.chain! : shopName();
    const nPoints = isChain ? rng.int(2, 3) : rng.weighted([1, 2, 3], [45, 35, 20]);
    const d0 = rng.pick(districtsForShops);
    const points: ClientPoint[] = [];
    for (let i = 0; i < nPoints; i++) points.push(point(rng, nextPoint, brandName, i === 0 ? d0 : rng.chance(0.6) ? d0 : rng.int(0, 3)));
    // две точки на одной улице различаем по дому: «Лотос» на Дзержинского, 45
    const dup = points.filter((pt) => points.filter((x) => x.name === pt.name).length > 1);
    for (const pt of dup) pt.name += ', ' + pt.address.split(', ').slice(1).join(', ');
    const name = kind === 'ip' ? `ИП ${owner.last} · «${brandName}»` : `ООО «${brandName}»`;
    const contacts = [{ id: nextContact(), name: `${owner.first} ${owner.patr} ${owner.last}`, role: kind === 'ip' ? 'Владелец' : 'Директор', phone: phone(rng) }];
    for (let i = rng.int(0, 2); i > 0; i--) contacts.push(contact(CONTACT_ROLES_SHOP));
    const deferDays = deferPick('shop');
    const client = baseClient({
      name,
      kind,
      segment: 'shop',
      inn: innFor(kind),
      points,
      contacts,
      deferDays,
      orderEveryDays: rng.pick([7, 10, 14, 14, 21]),
      minOrder: rng.weighted([0, 3000, 5000], [15, 60, 25]),
      note: rng.chance(0.35) ? rng.pick(CLIENT_NOTES) : '',
    });
    metas.push(mk('shop', { delivery: rng.float(0.15, 0.6), pickQ: rng.float(0.32, 0.46), payMethod: rng.weighted(['cash', 'card', 'transfer'] as const, [45, 15, 40]) }, client));
  }

  // ---- кафе и гостиницы, клининг ----
  for (const h of HORECA) {
    const p = person(rng, rng.chance(0.4));
    const name = h.kind === 'ip' ? `ИП ${p.last} · ${h.name}` : `ООО «${h.name.replace(/^[^«]*«|»$/g, '')}» · ${h.name.split(' «')[0]}`;
    const brand = h.name.replace(/^[^«]*«|»$/g, '');
    const client = baseClient({
      name,
      kind: h.kind,
      segment: 'horeca',
      inn: innFor(h.kind),
      points: [point(rng, nextPoint, brand, rng.weighted([0, 1, 2, 3], [45, 25, 20, 10]))],
      contacts: [contact(CONTACT_ROLES_ORG), ...(rng.chance(0.6) ? [contact(['Бухгалтер'])] : [])],
      deferDays: deferPick('horeca'),
      orderEveryDays: rng.pick([10, 14, 14, 21]),
      minOrder: rng.weighted([0, 3000], [50, 50]),
      note: rng.chance(0.5) ? rng.pick(CLIENT_NOTES) : '',
    });
    metas.push(mk('horeca', { delivery: 0.85, pickQ: 0.65, payMethod: 'transfer' }, client));
  }
  for (const c of CLEANING) {
    const p = person(rng, rng.chance(0.5));
    const brand = c.name.replace(/^[^«]*«|»$/g, '');
    const name = c.legal ?? (c.kind === 'ip' ? `ИП ${p.last} · ${c.name}` : `ООО «${c.name.replace(/[«»]/g, '')}»`);
    const client = baseClient({
      name,
      kind: c.kind,
      segment: 'cleaning',
      inn: innFor(c.kind),
      points: [point(rng, nextPoint, brand, rng.int(0, 3))],
      contacts: [contact(CONTACT_ROLES_ORG), contact(['Бухгалтер', 'Завхоз'])],
      deferDays: deferPick('cleaning'),
      orderEveryDays: rng.pick([14, 14, 21, 21, 30]),
      minOrder: 5000,
      note: rng.chance(0.4) ? 'Оплата по счёту, закрывающие документы на почту бухгалтеру' : '',
    });
    metas.push(mk('cleaning', { delivery: 0.8, pickQ: 0.65, payMethod: 'transfer' }, client));
  }

  // ---- рынки (14) ----
  for (let i = 0; i < 14; i++) {
    const p = person(rng, rng.chance(0.45));
    const market = MARKETS[i % MARKETS.length];
    const pav = rng.chance(0.5) ? `павильон ${rng.int(1, 60)}` : `ряд ${rng.int(1, 12)}, место ${rng.int(1, 40)}`;
    const d = market === 'Трусовский рынок' ? 3 : market === 'рынок на Кубанской' ? 1 : 0;
    const pt = point(rng, nextPoint, market, d);
    pt.name = `${market}, ${pav}`;
    const client = baseClient({
      name: `ИП ${p.last} · ${market}, ${pav}`,
      kind: 'ip',
      segment: 'market',
      inn: innFor('ip'),
      points: [pt],
      contacts: [{ id: nextContact(), name: `${p.first} ${p.patr} ${p.last}`, role: 'Владелец', phone: phone(rng) }],
      deferDays: deferPick('market'),
      orderEveryDays: rng.pick([7, 7, 10, 14]),
      minOrder: 10000,
      note: rng.chance(0.4) ? 'Платит наличными при получении' : '',
    });
    metas.push(mk('market', { delivery: 0.05, pickQ: 0.55, payMethod: rng.weighted(['cash', 'transfer'] as const, [70, 30]) }, client));
  }

  // ---- ответственные ----
  // Магазины и половина рынков — представители по районам; кафе, клининг и остальные рынки — менеджеры.
  const repByDistrict = (pt: ClientPoint): ID =>
    pt.district === 'Кировский район' ? E.mironova : pt.district === 'Ленинский район' ? E.tarasov : pt.district === 'Советский район' ? E.abdullaev : rng.chance(0.5) ? E.abdullaev : E.tarasov;
  let mi = 0;
  for (const m of metas) {
    const c = m.client;
    if (m.seg === 'shop' || (m.seg === 'market' && mi++ % 2 === 0)) m.owner = repByDistrict(c.points[0]);
    else m.owner = MANAGERS[(metas.indexOf(m) + 1) % 2];
  }
  // выравниваем точки у представителей: 25–40 у каждого
  const repPoints = (rep: ID): number => metas.filter((m) => m.owner === rep).reduce((s, m) => s + m.client.points.length, 0);
  for (let it = 0; it < 60; it++) {
    const counts = [E.mironova, E.abdullaev, E.tarasov].map((r) => ({ r, n: repPoints(r) })).sort((a, b) => b.n - a.n);
    if (counts[0].n - counts[2].n <= 4) break;
    const donor = metas.find((m) => m.owner === counts[0].r && m.client.points.length <= counts[0].n - counts[2].n - 1);
    if (!donor) break;
    donor.owner = counts[2].r;
  }
  // до выхода Тарасова его точки вели Миронова и Абдуллаев
  for (const m of metas) {
    m.startOwner = m.owner;
    if (m.owner === E.tarasov) m.startOwner = m.client.points[0].district === 'Трусовский район' ? E.abdullaev : E.mironova;
    m.client.ownerId = m.startOwner;
  }

  // ---- ассортимент, отсрочка, лимиты, платёжная дисциплина ----
  for (const m of metas) {
    const seg = m.seg as Exclude<ClientSegment, 'retail'>;
    const size = seg === 'shop' ? rng.int(24, 46) : seg === 'market' ? rng.int(14, 26) : rng.int(12, 22);
    m.assortment = assortment(rng, db, meta, seg, size);
    m.avgOrder = Math.round(orderValue(db, m.assortment, m.pickQ));
    m.cadence = m.client.orderEveryDays ?? 14;
    if (m.client.deferDays > 0) {
      m.discipline = rng.weighted(['good', 'late', 'bad'] as const, [64, 23, 13]);
      const cycles = m.client.deferDays / m.cadence + 1.2;
      m.client.creditLimit = Math.ceil((m.avgOrder * cycles * rng.float(1.3, 1.9)) / 10000) * 10000;
    }
  }
  // 3 клиента с лимитом впритык — владелец подтверждает сверх лимита
  const tightPool = metas.filter((m) => m.client.deferDays >= 14 && m.discipline !== 'good');
  for (const m of rng.sample(tightPool, 3)) {
    m.tight = true;
    m.client.creditLimit = Math.max(20000, Math.floor((m.avgOrder * 1.7) / 10000) * 10000);
  }

  // ---- новые клиенты за период: создаются операцией client.create ----
  const newOnes = rng.sample(
    metas.filter((m) => m.seg !== 'shop' || m.client.points.length === 1),
    8,
  );
  for (const m of newOnes) {
    m.isNew = true;
    m.createdAt = `2026-${rng.pick(['08', '09', '09', '10', '10'])}-${String(rng.int(3, 26)).padStart(2, '0')}`;
    if (m.createdAt < startDate) m.createdAt = '2026-08-20';
    if (m.owner === E.tarasov && m.createdAt < TARASOV_START) m.createdAt = TARASOV_START;
    m.client.createdAt = m.createdAt;
  }
  // двое новых в ноябре, с первыми заказами: магазин у представителя и клиент менеджера.
  // Новым — первый месяц без отсрочки: оплата при получении.
  const latest = newOnes.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const novRep = latest.find((m) => m.seg === 'shop' && !MANAGERS.includes(m.owner as (typeof MANAGERS)[number]));
  const novMgr = latest.find((m) => m !== novRep && MANAGERS.includes(m.owner as (typeof MANAGERS)[number]));
  for (const [m, day] of [[novRep, '2026-11-02'], [novMgr, '2026-11-03']] as const) {
    if (!m) continue;
    m.createdAt = day;
    m.client.createdAt = day;
    m.client.deferDays = 0;
    m.client.creditLimit = 0;
    m.discipline = 'good';
    m.client.note = 'Новый клиент: первый месяц без отсрочки, оплата при получении';
  }

  // ---- розничные покупатели с картой (25) ----
  const retailIds: ID[] = [];
  for (let i = 0; i < 25; i++) {
    const female = rng.chance(0.7);
    const p = person(rng, female);
    const client = baseClient({
      name: `${p.first} ${p.last}`,
      kind: 'person',
      segment: 'retail',
      note: `${RETAIL_CARD_PREFIX} ${String(rng.int(100, 2999)).padStart(4, '0')}`,
    });
    const cm = mk('retail', { owner: '', startOwner: '' }, client);
    if (i >= 23) {
      cm.isNew = true;
      cm.createdAt = `2026-10-${String(rng.int(2, 28)).padStart(2, '0')}`;
      client.createdAt = cm.createdAt;
    }
    metas.push(cm);
    retailIds.push(client.id);
  }

  // старые клиенты — сразу в базу; новые появятся операцией
  for (const m of metas) if (!m.isNew) db.clients.push(m.client);
  db.counters.client = clientN;
  db.counters.point = pointN;
  db.counters.contact = contactN;
  return { metas, retailIds };
}
