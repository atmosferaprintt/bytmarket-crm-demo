/* Изображение товара. Если владелец загрузил фото — показываем его; иначе рисуем упаковку:
   вид тары по категории (флакон, канистра, коробка, баллон, рулоны…), цвет — по бренду, оттенок — по вкусу,
   на этикетке бренд, вкус и объём. Рисунок примерный: настоящих снимков упаковок в демо нет. */
import { memo, useId } from 'react';
import type { Product } from '../data/types';
import { useDB } from '../data/store';
import { cx } from '../ui';

/* ---------- цвета ---------- */

const BRAND: Record<string, [string, string]> = {
  Fairy: ['#1F8F45', '#F5C400'],
  AOS: ['#1E6FD0', '#9AD3FF'],
  Sorti: ['#E4572E', '#FFD166'],
  Tide: ['#F26B1D', '#1F4FA3'],
  Ariel: ['#0B5CB5', '#2FA84F'],
  Persil: ['#1C7C3A', '#D7262E'],
  Losk: ['#1863B8', '#E53935'],
  Ласка: ['#6D3B9C', '#E8D9F5'],
  Lenor: ['#2E9BD6', '#A67BD8'],
  Vernel: ['#5B3FA8', '#7FD3E8'],
  'Ушастый нянь': ['#3BA9DE', '#FFD54F'],
  Frosch: ['#6FAE2E', '#FFFFFF'],
  Synergetic: ['#F2EFE7', '#6BAA3B'],
  BioMio: ['#EDEDEA', '#8CBF3F'],
  Grass: ['#D93636', '#2E7D32'],
  Finish: ['#0F3D91', '#E4002B'],
  Vanish: ['#E0177E', '#FFFFFF'],
  Domestos: ['#173B8A', '#F2C230'],
  'Cillit Bang': ['#D7263D', '#FFFFFF'],
  'Mr. Proper': ['#0098D8', '#F5D000'],
  Clin: ['#23A6DE', '#FFFFFF'],
  Cif: ['#F3F4F6', '#E2001A'],
  Comet: ['#2E7D32', '#F5F5F5'],
  Пемолюкс: ['#F28C28', '#1E5AA8'],
  Санфор: ['#0A9CD8', '#FFFFFF'],
  Tiret: ['#F4CF00', '#1F1F1F'],
  Palmolive: ['#2AA84A', '#F7E27A'],
  Dove: ['#E9EEF6', '#1A3D7C'],
  Duru: ['#EF7FA8', '#FFFFFF'],
  'Невская косметика': ['#F3E2C4', '#8B5A2B'],
  Zewa: ['#EAF2FB', '#1565C0'],
  Papia: ['#FFFFFF', '#D81B60'],
  'Мягкий знак': ['#FFFFFF', '#3E9E45'],
  Paclan: ['#D32F2F', '#FFFFFF'],
  Avikomp: ['#263238', '#7CB342'],
  'Фрекен Бок': ['#FFC107', '#2E7D32'],
  Vileda: ['#E53935', '#FFFFFF'],
  York: ['#1976D2', '#FFC107'],
  Glade: ['#6A1B9A', '#F8BBD0'],
  'Air Wick': ['#7B1FA2', '#FFD1E8'],
};

const SCENT: [RegExp, string][] = [
  [/лимон/i, '#F7D631'],
  [/апельсин|мандарин|цитрус/i, '#FF9800'],
  [/яблок|алоэ|огурец/i, '#8BC34A'],
  [/лаванд|сирен/i, '#9575CD'],
  [/морск|свеж|бриз|океан|горн|родник|озер|ручей|облак/i, '#4FC3F7'],
  [/ромашк|мёд|мед|молоч|ванил/i, '#F6C76B'],
  [/клубник|ягод|малин|гранат|вишн/i, '#E91E63'],
  [/хвой|сосн|ель|мят|эвкалипт/i, '#2E9D6B'],
  [/роз|пион|орхиде|цвет/i, '#F48FB1'],
  [/color|колор|цвета/i, '#EC407A'],
  [/детск|нежн|сенсе|без запаха|гипоаллерг/i, '#90CAF9'],
  [/белый|белого|белые|хлор|отбел/i, '#B3E5FC'],
  [/чёрн|черн/i, '#37474F'],
];

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function hex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
}
function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}
function lum(c: string): number {
  const [r, g, b] = rgb(c).map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Для бренда без цвета — устойчивый оттенок по названию. */
function hashColor(s: string): string {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const palette = ['#1E6FD0', '#2E9D6B', '#D93636', '#7B1FA2', '#F26B1D', '#0098D8', '#455A64'];
  return palette[h % palette.length];
}

/* ---------- вид упаковки ---------- */

type Shape =
  | 'jug' | 'squeeze' | 'bottle' | 'spray' | 'pump' | 'duck' | 'carton' | 'pouch' | 'tub' | 'jar'
  | 'soap' | 'barSoap' | 'rolls' | 'tissue' | 'can' | 'canister' | 'rollbox' | 'bagroll' | 'pack' | 'wcblock';
type PackItem = 'sponge' | 'cloth' | 'gloves' | 'rag' | 'tshirt';

/** Литры или килограммы из «1,3 л», «900 мл», «4,5 кг», «400 г». */
function amount(volume: string | null): { v: number; unit: 'l' | 'kg' | 'pcs' | null } {
  if (!volume) return { v: 0, unit: null };
  const m = /([\d,.]+)\s*(мл|л|кг|г|шт)/.exec(volume);
  if (!m) return { v: 0, unit: null };
  const n = parseFloat(m[1].replace(',', '.'));
  if (m[2] === 'мл') return { v: n / 1000, unit: 'l' };
  if (m[2] === 'л') return { v: n, unit: 'l' };
  if (m[2] === 'г') return { v: n / 1000, unit: 'kg' };
  if (m[2] === 'кг') return { v: n, unit: 'kg' };
  return { v: n, unit: 'pcs' };
}

function shapeFor(cat: string, p: Product): { shape: Shape; item?: PackItem } {
  const a = amount(p.volume);
  const name = p.name.toLowerCase();
  switch (cat) {
    case 'cat-laundry-powder':
      return { shape: a.v >= 2.4 ? 'carton' : 'pouch' };
    case 'cat-laundry-gel':
    case 'cat-laundry-softener':
      return { shape: 'jug' };
    case 'cat-laundry-caps':
      return { shape: 'tub' };
    case 'cat-laundry-bleach':
      return { shape: a.unit === 'kg' ? 'tub' : 'bottle' };
    case 'cat-dishes-liquid':
      return { shape: a.v >= 3 ? 'jug' : 'squeeze' };
    case 'cat-dishes-pmm':
      return { shape: 'carton' };
    case 'cat-clean-universal':
      return { shape: a.v >= 3 ? 'jug' : 'bottle' };
    case 'cat-clean-glass':
    case 'cat-clean-kitchen':
      return { shape: a.v >= 3 ? 'jug' : 'spray' };
    case 'cat-clean-floor':
      return { shape: a.v > 1 ? 'jug' : 'bottle' };
    case 'cat-san-gel':
      return { shape: a.v >= 3 ? 'jug' : 'duck' };
    case 'cat-san-powder':
      return { shape: /крем|cream/.test(name) ? 'squeeze' : 'canister' };
    case 'cat-san-pipes':
      return { shape: a.unit === 'kg' ? 'pouch' : 'bottle' };
    case 'cat-san-wc':
      return { shape: 'wcblock' };
    case 'cat-hyg-soap':
      return { shape: 'soap' };
    case 'cat-hyg-household':
      return { shape: a.unit === 'l' ? (a.v >= 3 ? 'jug' : 'bottle') : 'barSoap' };
    case 'cat-hyg-liquid':
      return { shape: a.v >= 3 ? 'jug' : 'pump' };
    case 'cat-hyg-shower':
      return { shape: 'squeeze' };
    case 'cat-paper-toilet':
    case 'cat-paper-towels':
      return { shape: 'rolls' };
    case 'cat-paper-napkins':
      return { shape: 'tissue' };
    case 'cat-bags-trash':
    case 'cat-bags-food':
      return { shape: 'bagroll' };
    case 'cat-bags-tshirt':
      return { shape: 'pack', item: 'tshirt' };
    case 'cat-sp-sponges':
      return { shape: 'pack', item: 'sponge' };
    case 'cat-sp-micro':
      return { shape: 'pack', item: 'cloth' };
    case 'cat-sp-floor':
      return { shape: 'pack', item: 'rag' };
    case 'cat-sp-gloves':
      return { shape: 'pack', item: 'gloves' };
    case 'cat-air-spray':
    case 'cat-air-auto':
      return { shape: 'can' };
    case 'cat-air-gel':
      return { shape: 'jar' };
    case 'cat-kit-foil':
    case 'cat-kit-film':
    case 'cat-kit-paper':
    case 'cat-kit-sleeve':
      return { shape: 'rollbox' };
    default:
      return { shape: 'bottle' };
  }
}

/* ---------- этикетка ---------- */

interface Colors {
  main: string;
  dark: string;
  light: string;
  accent: string;
  label: string; // фон этикетки
  ink: string; // текст на этикетке
  brandInk: string; // цвет бренда на этикетке
}

function fit(text: string, width: number, max: number): number {
  return Math.max(6, Math.min(max, (width / Math.max(1, text.length)) * 1.75));
}

function Label({ x, y, w, h, brand, line, vol, c, r = 6 }: { x: number; y: number; w: number; h: number; brand: string; line: string; vol: string; c: Colors; r?: number }) {
  const cx0 = x + w / 2;
  const compact = h < 52; // низкая этикетка (мыло): только бренд и объём
  const bSize = fit(brand, w - 8, 15);
  const lSize = fit(line, w - 8, 9.5);
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={r} fill={c.label} />
      <rect x={x} y={y + h - 4} width={w} height={4} fill={c.accent} opacity={0.9} />
      <text x={cx0} y={y + (compact ? h * 0.46 : h * 0.36)} textAnchor="middle" fontWeight={700} fontSize={bSize} fill={c.brandInk} style={{ letterSpacing: '-0.02em' }}>
        {brand}
      </text>
      {line && !compact ? (
        <text x={cx0} y={y + h * 0.36 + lSize + 4} textAnchor="middle" fontWeight={600} fontSize={lSize} fill={c.ink} opacity={0.85}>
          {line}
        </text>
      ) : null}
      {vol && compact ? (
        <text x={cx0} y={y + h - 8} textAnchor="middle" fontWeight={700} fontSize={8} fill={c.ink}>
          {vol}
        </text>
      ) : vol ? (
        <g>
          <rect x={cx0 - Math.min(w - 8, vol.length * 5.6 + 10) / 2} y={y + h - 20} width={Math.min(w - 8, vol.length * 5.6 + 10)} height={12} rx={6} fill={c.main} opacity={c.label === c.main ? 0 : 0.95} />
          <text x={cx0} y={y + h - 11} textAnchor="middle" fontWeight={700} fontSize={8} fill={c.label === c.main ? c.ink : lum(c.main) > 0.7 ? c.dark : '#FFFFFF'}>
            {vol}
          </text>
        </g>
      ) : null}
    </g>
  );
}

/* ---------- формы ---------- */

function Art({ shape, item, c, brand, line, vol, id }: { shape: Shape; item?: PackItem; c: Colors; brand: string; line: string; vol: string; id: string }) {
  const shine = `url(#${id}-shine)`;
  const body = (d: string, fill = c.main) => (
    <>
      <path d={d} fill={fill} />
      <path d={d} fill={shine} />
    </>
  );
  const lab = (x: number, y: number, w: number, h: number, r?: number) => <Label x={x} y={y} w={w} h={h} brand={brand} line={line} vol={vol} c={c} r={r} />;
  switch (shape) {
    case 'jug':
      return (
        <g>
          <rect x={66} y={40} width={30} height={20} rx={5} fill={c.accent} />
          <rect x={66} y={40} width={30} height={20} rx={5} fill={shine} />
          {body('M58 76 Q58 58 76 58 H118 L124 50 Q128 46 134 46 H138 Q146 46 146 56 V164 Q146 178 132 178 H70 Q58 178 58 164 Z')}
          <rect x={112} y={60} width={24} height={24} rx={8} fill={`url(#${id}-bg)`} />
          {lab(66, 98, 72, 70)}
        </g>
      );
    case 'squeeze':
      return (
        <g>
          <rect x={86} y={28} width={28} height={20} rx={6} fill={c.accent} />
          <rect x={95} y={22} width={10} height={8} rx={3} fill={c.accent} />
          <rect x={90} y={46} width={20} height={10} fill={c.dark} />
          {body('M82 56 H118 Q126 64 128 84 L130 166 Q130 178 118 178 H82 Q70 178 70 166 L72 84 Q74 64 82 56 Z')}
          {lab(76, 98, 48, 66)}
        </g>
      );
    case 'bottle':
      return (
        <g>
          <rect x={86} y={30} width={28} height={22} rx={4} fill={c.accent} />
          {[90, 96, 102, 108].map((x) => (
            <rect key={x} x={x} y={32} width={2} height={18} fill={c.dark} opacity={0.25} />
          ))}
          {body('M88 52 H112 L114 62 Q128 66 128 82 V166 Q128 178 116 178 H84 Q72 178 72 166 V82 Q72 66 86 62 Z')}
          {lab(77, 96, 46, 70)}
        </g>
      );
    case 'spray':
      return (
        <g>
          <rect x={60} y={52} width={20} height={9} rx={3} fill={c.dark} />
          <path d="M80 44 H126 Q134 44 134 52 V62 Q134 70 126 70 H104 L100 84 H90 L88 70 Q80 68 80 60 Z" fill={c.accent} />
          <path d="M98 70 Q92 86 100 96 L108 94 Q102 84 106 70 Z" fill={c.accent} />
          <rect x={88} y={80} width={22} height={10} fill={c.dark} />
          {body('M80 92 Q80 88 86 88 H112 Q118 88 120 96 L124 166 Q124 178 112 178 H84 Q72 178 72 166 L76 100 Q76 92 80 92 Z')}
          {lab(78, 106, 42, 62)}
        </g>
      );
    case 'pump':
      return (
        <g>
          <path d="M82 40 H120 Q124 40 124 44 V48 H140 Q144 48 144 52 V56 H124 Q124 58 120 58 H82 Q78 58 78 54 V44 Q78 40 82 40 Z" fill={c.accent} />
          <rect x={96} y={58} width={8} height={20} fill={c.dark} />
          <rect x={84} y={76} width={32} height={14} rx={3} fill={c.accent} />
          {body('M70 90 H130 Q142 90 142 104 V166 Q142 178 130 178 H70 Q58 178 58 166 V104 Q58 90 70 90 Z')}
          {lab(68, 104, 64, 64)}
        </g>
      );
    case 'duck':
      return (
        <g>
          <path d="M90 92 C88 72 80 58 64 52 L60 60 C72 66 78 76 80 94 Z" fill={c.main} />
          <circle cx={60} cy={55} r={8} fill={c.accent} />
          {body('M78 96 Q78 88 86 88 H116 Q124 88 124 96 L128 166 Q128 178 116 178 H84 Q72 178 72 166 Z')}
          {lab(78, 108, 46, 60)}
        </g>
      );
    case 'carton':
      return (
        <g>
          <path d="M52 62 L70 48 H158 L140 62 Z" fill={c.light} />
          <path d="M140 62 L158 48 V164 L140 178 Z" fill={c.dark} />
          {body('M52 62 H140 V178 H52 Z')}
          <path d="M84 56 Q96 50 108 56" stroke={c.dark} strokeWidth={4} fill="none" strokeLinecap="round" opacity={0.5} />
          <circle cx={118} cy={80} r={14} fill={c.accent} />
          {lab(58, 96, 76, 72)}
        </g>
      );
    case 'pouch':
      return (
        <g>
          {body('M60 54 Q100 46 140 54 L146 164 Q146 176 134 176 H66 Q54 176 54 164 Z')}
          <path d="M62 66 Q100 60 138 66" stroke="#FFFFFF" strokeOpacity={0.6} strokeWidth={2} fill="none" />
          <path d="M60 54 Q100 46 140 54 L141 62 Q100 54 59 62 Z" fill={c.dark} opacity={0.35} />
          {lab(64, 86, 72, 74)}
        </g>
      );
    case 'tub':
      return (
        <g>
          {body('M58 78 L64 164 Q65 176 78 176 H122 Q135 176 136 164 L142 78 Z')}
          <rect x={52} y={60} width={96} height={22} rx={7} fill={c.accent} />
          <rect x={52} y={60} width={96} height={22} rx={7} fill={shine} />
          <rect x={60} y={64} width={80} height={4} rx={2} fill="#FFFFFF" opacity={0.35} />
          {lab(68, 96, 64, 66)}
        </g>
      );
    case 'jar':
      return (
        <g>
          {body('M66 104 Q66 96 74 96 H126 Q134 96 134 104 V164 Q134 176 122 176 H78 Q66 176 66 164 Z')}
          <rect x={60} y={82} width={80} height={18} rx={6} fill={c.accent} />
          {[72, 84, 96, 108, 120].map((x) => (
            <rect key={x} x={x} y={86} width={6} height={10} rx={2} fill={c.dark} opacity={0.3} />
          ))}
          {lab(72, 110, 56, 56)}
        </g>
      );
    case 'soap':
      return (
        <g>
          <path d="M44 106 L60 94 H162 L146 106 Z" fill={c.light} />
          <path d="M146 106 L162 94 V146 L146 158 Z" fill={c.dark} />
          {body('M44 106 H146 V158 H44 Z')}
          {lab(52, 112, 86, 40, 8)}
        </g>
      );
    case 'barSoap':
      return (
        <g>
          <path d="M46 108 L62 96 H160 L144 108 Z" fill="#C79A6B" />
          <path d="M144 108 L160 96 V144 L144 156 Z" fill="#8E6440" />
          <path d="M46 108 H144 V156 H46 Z" fill="#A9784C" />
          <path d="M46 108 H144 V156 H46 Z" fill={shine} />
          <text x={95} y={128} textAnchor="middle" fontWeight={700} fontSize={fit(brand, 88, 12)} fill="#7A5232" opacity={0.85}>
            {brand}
          </text>
          <text x={95} y={147} textAnchor="middle" fontWeight={700} fontSize={12} fill="#7A5232" opacity={0.85}>
            {line || '72 %'}
          </text>
        </g>
      );
    case 'rolls': {
      const two = /2 рул/.test(vol);
      const cols = two ? 2 : 2;
      const rows = two ? 1 : 2;
      const rw = 46;
      const rh = two ? 96 : 48;
      return (
        <g>
          <rect x={46} y={two ? 70 : 70} width={108} height={two ? 108 : 108} rx={14} fill="#FFFFFF" opacity={0.92} />
          {Array.from({ length: cols * rows }).map((_, i) => {
            const x = 52 + (i % cols) * (rw + 4);
            const y = 74 + Math.floor(i / cols) * (rh + 4);
            return (
              <g key={i}>
                <rect x={x} y={y} width={rw} height={rh} rx={8} fill="#F7F8FA" stroke="#E3E7EE" />
                <rect x={x + 4} y={y} width={3} height={rh} fill="#E3E7EE" />
              </g>
            );
          })}
          <rect x={46} y={70} width={108} height={108} rx={14} fill={shine} />
          <rect x={46} y={106} width={108} height={36} fill={c.main === '#FFFFFF' || lum(c.main) > 0.85 ? c.accent : c.main} />
          <text x={100} y={124} textAnchor="middle" fontWeight={700} fontSize={fit(brand, 96, 15)} fill="#FFFFFF">
            {brand}
          </text>
          <text x={100} y={137} textAnchor="middle" fontWeight={600} fontSize={8.5} fill="#FFFFFF" opacity={0.9}>
            {vol}
          </text>
        </g>
      );
    }
    case 'tissue':
      return (
        <g>
          <path d="M44 100 L60 88 H160 L144 100 Z" fill={c.light} />
          <ellipse cx={102} cy={94} rx={30} ry={5} fill={c.dark} opacity={0.4} />
          <path d="M90 94 Q98 70 104 84 Q110 66 116 94 Z" fill="#FFFFFF" />
          <path d="M144 100 L160 88 V160 L144 172 Z" fill={c.dark} />
          {body('M44 100 H144 V172 H44 Z')}
          {lab(52, 108, 84, 58)}
        </g>
      );
    case 'can':
      return (
        <g>
          <rect x={84} y={34} width={32} height={30} rx={12} fill={c.accent} />
          <rect x={84} y={34} width={32} height={30} rx={12} fill={shine} />
          {body('M74 80 Q74 64 100 62 Q126 64 126 80 V168 Q126 178 116 178 H84 Q74 178 74 168 Z')}
          {lab(78, 96, 44, 68)}
        </g>
      );
    case 'canister':
      return (
        <g>
          <ellipse cx={100} cy={58} rx={34} ry={8} fill={c.accent} />
          {[86, 96, 106, 116].map((x) => (
            <circle key={x} cx={x} cy={58} r={1.8} fill={c.dark} opacity={0.5} />
          ))}
          {body('M66 60 H134 V166 Q134 178 122 178 H78 Q66 178 66 166 Z')}
          {lab(72, 86, 56, 76)}
        </g>
      );
    case 'rollbox':
      return (
        <g>
          <path d="M24 104 L40 92 H180 L164 104 Z" fill={c.light} />
          <path d="M164 104 L180 92 V138 L164 150 Z" fill={c.dark} />
          {body('M24 104 H164 V150 H24 Z')}
          <rect x={30} y={110} width={84} height={34} rx={5} fill={c.label} />
          <text x={72} y={126} textAnchor="middle" fontWeight={700} fontSize={fit(brand, 76, 13)} fill={c.brandInk}>
            {brand}
          </text>
          <text x={72} y={138} textAnchor="middle" fontWeight={600} fontSize={8} fill={c.ink}>
            {vol}
          </text>
          <circle cx={140} cy={127} r={13} fill="#D9DEE5" />
          <circle cx={140} cy={127} r={13} fill={shine} />
          <circle cx={140} cy={127} r={4} fill="#9AA4B2" />
        </g>
      );
    case 'bagroll': {
      const bag = /чёрн|черн/i.test(line) ? '#2B2F36' : /син/i.test(line) ? '#2F5FB3' : /зел/i.test(line) ? '#2E7D4F' : /прозр|фасов/i.test(line + brand) ? '#DDE6EE' : c.dark;
      return (
        <g>
          <rect x={36} y={98} width={128} height={58} rx={29} fill={bag} />
          <rect x={36} y={98} width={128} height={58} rx={29} fill={shine} />
          <ellipse cx={150} cy={127} rx={14} ry={29} fill={mix(bag, '#000000', 0.25)} />
          <ellipse cx={150} cy={127} rx={5} ry={10} fill="#B8C2CC" />
          <rect x={66} y={98} width={58} height={58} fill={c.label} />
          <rect x={66} y={150} width={58} height={6} fill={c.accent} />
          <text x={95} y={122} textAnchor="middle" fontWeight={700} fontSize={fit(brand, 52, 12)} fill={c.brandInk}>
            {brand}
          </text>
          <text x={95} y={135} textAnchor="middle" fontWeight={600} fontSize={7.5} fill={c.ink}>
            {vol.length > 14 ? vol.slice(0, 14) : vol}
          </text>
        </g>
      );
    }
    case 'pack':
      return (
        <g>
          {body('M60 38 H140 Q148 38 148 46 V168 Q148 176 140 176 H60 Q52 176 52 168 V46 Q52 38 60 38 Z')}
          <ellipse cx={100} cy={50} rx={11} ry={4} fill={`url(#${id}-bg)`} />
          <rect x={62} y={64} width={76} height={72} rx={8} fill="#FFFFFF" opacity={0.9} />
          <PackContent item={item ?? 'sponge'} c={c} />
          <rect x={52} y={140} width={96} height={28} fill={c.label === '#FFFFFF' ? c.dark : c.label} opacity={0.95} />
          <text x={100} y={158} textAnchor="middle" fontWeight={700} fontSize={fit(brand, 84, 13)} fill={c.label === '#FFFFFF' ? '#FFFFFF' : c.brandInk}>
            {brand}
          </text>
        </g>
      );
    case 'wcblock':
      return (
        <g>
          {body('M64 36 H136 Q144 36 144 44 V168 Q144 176 136 176 H64 Q56 176 56 168 V44 Q56 36 64 36 Z')}
          <ellipse cx={100} cy={48} rx={10} ry={4} fill={`url(#${id}-bg)`} />
          <rect x={70} y={62} width={60} height={70} rx={16} fill="#FFFFFF" opacity={0.85} />
          <path d="M100 66 V80" stroke={c.dark} strokeWidth={3} />
          <rect x={82} y={80} width={36} height={30} rx={8} fill={c.accent} />
          <rect x={88} y={110} width={24} height={14} rx={4} fill={mix(c.accent, '#FFFFFF', 0.4)} />
          <text x={100} y={152} textAnchor="middle" fontWeight={700} fontSize={fit(brand, 80, 13)} fill={lum(c.main) > 0.7 ? c.dark : '#FFFFFF'}>
            {brand}
          </text>
          <text x={100} y={166} textAnchor="middle" fontWeight={600} fontSize={8} fill={lum(c.main) > 0.7 ? c.dark : '#FFFFFF'} opacity={0.85}>
            {line}
          </text>
        </g>
      );
  }
}

function PackContent({ item, c }: { item: PackItem; c: Colors }) {
  switch (item) {
    case 'sponge':
      return (
        <g>
          {[0, 1, 2].map((i) => (
            <g key={i} transform={`translate(${70 + i * 22} ${74 + (i % 2) * 6})`}>
              <rect width={18} height={40} rx={4} fill="#FFD54F" />
              <rect width={18} height={12} rx={3} fill="#43A047" />
            </g>
          ))}
        </g>
      );
    case 'cloth':
      return (
        <g>
          <rect x={72} y={78} width={44} height={44} rx={4} fill={c.accent === '#FFFFFF' ? '#4FC3F7' : c.accent} transform="rotate(-8 94 100)" />
          <rect x={86} y={74} width={44} height={44} rx={4} fill={mix(c.main, '#FFFFFF', 0.25)} transform="rotate(8 108 96)" />
        </g>
      );
    case 'rag':
      return <path d="M70 84 Q100 72 130 84 L128 126 Q100 134 72 126 Z" fill="#B0BEC5" stroke="#90A4AE" />;
    case 'gloves':
      return (
        <g fill="#FFCA28">
          <path d="M80 128 V96 Q80 90 84 90 Q88 90 88 96 V86 Q88 80 92 80 Q96 80 96 86 V84 Q96 78 100 78 Q104 78 104 84 V90 Q104 84 108 84 Q112 84 112 90 V112 Q112 128 98 132 Z" />
          <path d="M100 130 V98 Q100 92 104 92 Q108 92 108 98 V88 Q108 82 112 82 Q116 82 116 88 V86 Q116 80 120 80 Q124 80 124 86 V92 Q124 86 128 86 Q132 86 132 92 V114 Q132 130 118 134 Z" fill="#FFB300" />
        </g>
      );
    case 'tshirt':
      return <path d="M78 78 H88 Q90 90 100 90 Q110 90 112 78 H122 V128 H78 Z" fill={mix(c.main, '#FFFFFF', 0.35)} stroke={c.dark} strokeOpacity={0.3} />;
  }
}

/* ---------- компонент ---------- */

export interface ProductPhotoProps {
  product: Product;
  /** ширина и высота в пикселях */
  size?: number;
  className?: string;
}

/** Фото товара: загруженное владельцем или нарисованная упаковка. */
export const ProductPhoto = memo(function ProductPhoto({ product: p, size = 40, className }: ProductPhotoProps) {
  const db = useDB();
  const id = useId().replace(/:/g, '');
  if (p.photo) {
    return <img className={cx('product-photo', className)} src={p.photo} alt={p.name} width={size} height={size} style={{ width: size, height: size }} loading="lazy" />;
  }
  const brandName = db.brands.find((b) => b.id === p.brandId)?.name ?? '';
  const [main0, accent0] = BRAND[brandName] ?? [hashColor(brandName), '#FFFFFF'];
  const scent = SCENT.find(([re]) => re.test(`${p.variant ?? ''} ${p.scent ?? ''} ${p.name.split(', ')[0]}`))?.[1];
  const main = main0;
  const light = lum(main) > 0.8;
  const accent = scent ?? (accent0 === '#FFFFFF' && light ? mix(main, '#000000', 0.4) : accent0);
  const c: Colors = {
    main,
    dark: mix(main, '#000000', light ? 0.35 : 0.3),
    light: mix(main, '#FFFFFF', 0.35),
    accent,
    label: light ? '#FFFFFF' : '#FFFFFF',
    ink: '#3A4250',
    brandInk: light ? mix(accent0 === '#FFFFFF' ? main : accent0, '#000000', 0.15) : main,
  };
  const { shape, item } = shapeFor(p.categoryId, p);
  const head = p.name.split(', ')[0];
  const line = head.startsWith(brandName) ? head.slice(brandName.length).trim() : head;
  const shortLine = line.length > 18 ? line.slice(0, 17).trimEnd() + '…' : line;
  const vol = p.volume ?? '';
  const bg = mix(main, '#FFFFFF', light ? 0.6 : 0.9);
  return (
    <svg className={cx('product-photo', className)} width={size} height={size} viewBox="0 0 200 200" role="img" aria-label={p.name}>
      <defs>
        <radialGradient id={`${id}-bg`} cx="50%" cy="40%" r="75%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor={bg} />
        </radialGradient>
        <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#000000" stopOpacity={0.1} />
          <stop offset="18%" stopColor="#FFFFFF" stopOpacity={0.32} />
          <stop offset="34%" stopColor="#FFFFFF" stopOpacity={0} />
          <stop offset="78%" stopColor="#000000" stopOpacity={0} />
          <stop offset="100%" stopColor="#000000" stopOpacity={0.16} />
        </linearGradient>
      </defs>
      <rect width={200} height={200} fill={`url(#${id}-bg)`} />
      <ellipse cx={100} cy={181} rx={60} ry={7} fill="#0F1E3D" opacity={0.1} />
      <Art shape={shape} item={item} c={c} brand={brandName} line={shortLine} vol={vol} id={id} />
    </svg>
  );
});
