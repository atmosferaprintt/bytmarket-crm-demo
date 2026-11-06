/* Режим обучения: кнопка в шапке, отметки «?» у элементов экрана и всплывающие подсказки с шагами.
   Отметки ищут элементы по селекторам из реестра подсказок (registry.ts) и следуют за ними при прокрутке.
   Если открыто окно или карточка — подсказки только для неё (то, что под ней, не мешает). */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, GraduationCap, RotateCcw, X } from 'lucide-react';
import { cx } from '../../ui';
import { useSession } from '../../roles/session';
import type { HintDef } from './types';
import { HINTS } from './registry';
import { markSeen, resetSeen, setTraining, useTraining } from './state';

interface Hit {
  def: HintDef;
  el: Element;
  x: number; // прямоугольник элемента в окне
  y: number;
  w: number;
  h: number;
  /** элемент есть, но сейчас за краем экрана — отметку не рисуем, «Дальше» прокрутит к нему */
  off: boolean;
  /** выше этой линии отметку не ставим (шапка страницы) */
  minTop: number;
  /** ниже этой линии — тоже (нижнее меню телефона) */
  maxBottom: number;
}

const PHONE_Q = '(max-width: 760px)';

function isPhone(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(PHONE_Q).matches;
}

/** Видимая часть элемента. null — элемента не видно совсем (скрыт). off — есть, но за краем экрана или
    прокручиваемого блока (таблица, боковая панель): до него можно докрутить. safeTop — ниже шапки страницы. */
function visibleRect(el: Element, safeTop = 0, safeBottom = window.innerHeight): { r: DOMRect; off: boolean } | null {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  const st = getComputedStyle(el);
  if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) return null;
  let top = Math.max(r.top, safeTop);
  let bottom = Math.min(r.bottom, safeBottom);
  let left = Math.max(r.left, 0);
  let right = Math.min(r.right, window.innerWidth);
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (/(auto|scroll|hidden|clip)/.test(s.overflow + s.overflowX + s.overflowY)) {
      const pr = p.getBoundingClientRect();
      top = Math.max(top, pr.top);
      bottom = Math.min(bottom, pr.bottom);
      left = Math.max(left, pr.left);
      right = Math.min(right, pr.right);
    }
  }
  if (right - left < 2) return null; // спрятан сбоку (обрезан) — не наш случай
  if (bottom - top < 2) return { r, off: true }; // выше или ниже видимого — докрутим
  return { r: new DOMRect(left, top, right - left, bottom - top), off: false };
}

function matchesPath(def: HintDef, path: string): boolean {
  const list = Array.isArray(def.path) ? def.path : [def.path];
  return list.some((p) => p === '*' || p === path);
}

/** Что сейчас на экране: подсказки, у которых элемент виден. Сначала свои, потом общие (если элемент свободен). */
function collect(defs: HintDef[], root: Element): Hit[] {
  const used = new Set<Element>();
  // элементы страницы — ниже шапки; в окнах и карточках шапки нет
  const inLayer = root.hasAttribute('data-layer-id');
  const topbar = inLayer ? null : document.querySelector('.topbar');
  const safeTop = topbar ? topbar.getBoundingClientRect().bottom : 0;
  const mbar = inLayer ? null : document.querySelector('.mobile-bar');
  const mbarTop = mbar ? mbar.getBoundingClientRect().top : 0;
  const safeBottom = mbar && mbarTop > 0 && mbarTop < window.innerHeight ? mbarTop : window.innerHeight;
  const out: Hit[] = [];
  const ordered = [...defs.filter((d) => !d.generic), ...defs.filter((d) => d.generic)];
  for (const d of ordered) {
    let els: Element[] = [];
    try {
      els = [...root.querySelectorAll(d.target)];
    } catch {
      continue; // неверный селектор — пропускаем, не ломая экран
    }
    for (const el of els) {
      if (used.has(el)) continue;
      if (el.closest('.hint-layer')) continue;
      // общая подсказка не ставится на элемент внутри того, у которого уже есть своя
      if (d.generic && [...used].some((u) => u.contains(el) || el.contains(u))) continue;
      const inTopbar = !!topbar && topbar.contains(el);
      const inBar = !!mbar && mbar.contains(el);
      const minTop = inTopbar ? 0 : safeTop;
      const maxBottom = inBar ? window.innerHeight : safeBottom;
      const v = visibleRect(el, minTop, maxBottom);
      if (!v) continue;
      used.add(el);
      out.push({ def: d, el, x: v.r.left, y: v.r.top, w: v.r.width, h: v.r.height, off: v.off, minTop, maxBottom });
      break;
    }
  }
  // порядок шагов: сначала то, что на экране (подсказки раздела), потом общие (таблица, вкладки), в конце шапка и меню;
  // внутри группы — как читают: сверху вниз, слева направо
  const group = (h: Hit): number => (h.def.id.startsWith('shell.') ? 2 : h.def.generic ? 1 : 0);
  return out.sort(
    (a, b) =>
      group(a) - group(b) ||
      (a.def.order ?? 1000) - (b.def.order ?? 1000) ||
      (Math.abs(a.y - b.y) > 24 ? a.y - b.y : a.x - b.x),
  );
}

/** Где поставить отметку: у кнопок и полей — над правым верхним углом, у больших блоков — над левым
    (справа у карточек и окон крестик закрытия, его не закрываем). */
function beaconPos(h: Hit): { left: number; top: number } {
  // поле с подписью сверху — как мелкий элемент: слева над ним первая буква подписи
  const field = h.el.matches('label.field') || !!h.el.querySelector(':scope > .field-label');
  const big = !field && h.w > 220 && h.h > 44;
  // у мелких — чуть правее и выше угла, чтобы не закрывать последние буквы подписи;
  // у больших — за левым верхним углом, чтобы не закрывать первую букву заголовка
  const left = big ? h.x - 16 : h.x + h.w - 6;
  const top = Math.min(Math.max(h.y - 15, h.minTop + 2), h.maxBottom - 26);
  return { left: Math.max(4, Math.min(window.innerWidth - 28, left)), top: Math.max(4, Math.min(window.innerHeight - 28, top)) };
}

/** Отметки по порядку; если две встали почти в одну точку — следующую сдвигаем вбок, чтобы обе были видны. */
function placeBeacons(hits: Hit[]): ({ left: number; top: number } | null)[] {
  const placed: { left: number; top: number }[] = [];
  return hits.map((h) => {
    if (h.off) return null;
    const p = beaconPos(h);
    for (let k = 0; k < 4 && placed.some((q) => Math.abs(q.left - p.left) < 24 && Math.abs(q.top - p.top) < 24); k++) {
      p.left = p.left - 28 >= 4 ? p.left - 28 : p.left + 56;
    }
    placed.push(p);
    return p;
  });
}

export function TrainingToggle() {
  const { on } = useTraining();
  return (
    <button
      type="button"
      className={cx('btn btn-ghost btn-icon topbar-training', on && 'is-on')}
      aria-pressed={on}
      aria-label={on ? 'Выключить режим обучения' : 'Режим обучения: подсказки на экране'}
      title={on ? 'Выключить режим обучения' : 'Обучение: подсказки на экране'}
      data-hint="shell.training"
      onClick={() => setTraining(!on)}
    >
      <GraduationCap />
    </button>
  );
}

export function HintLayer() {
  const { on, seen } = useTraining();
  const { role } = useSession();
  const { pathname } = useLocation();
  const [hits, setHits] = useState<Hit[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [phone, setPhone] = useState(isPhone);
  const layerRef = useRef<HTMLDivElement>(null);
  const lastKey = useRef('');
  // обучение было включено ещё до открытия страницы — подсказку сами не открываем, только отметки
  const startedTour = useRef(on);

  const defs = useMemo(
    () => HINTS.filter((d) => matchesPath(d, pathname) && (!d.roles || d.roles.includes(role)) && (!d.device || d.device === (phone ? 'phone' : 'desktop'))),
    [pathname, role, phone],
  );

  // пересчёт мест отметок: прокрутка, размер окна, изменения на странице; обновляем, только если что-то сдвинулось
  const recompute = useCallback(() => {
    const layers = [...document.querySelectorAll('[data-layer-id]')];
    const root = layers[layers.length - 1] ?? document.querySelector('.app') ?? document.body;
    const next = collect(defs, root);
    const key = next.map((h) => `${h.def.id}:${Math.round(h.x)}:${Math.round(h.y)}:${Math.round(h.w)}:${Math.round(h.h)}`).join('|');
    if (key !== lastKey.current) {
      lastKey.current = key;
      setHits(next);
    }
  }, [defs]);

  useEffect(() => {
    if (!on) {
      setHits([]);
      setOpenId(null);
      lastKey.current = '';
      startedTour.current = false;
      return;
    }
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(recompute);
    };
    const mq = window.matchMedia(PHONE_Q);
    const onMq = () => setPhone(mq.matches);
    mq.addEventListener('change', onMq);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    const mo = new MutationObserver((list) => {
      if (list.every((m) => layerRef.current?.contains(m.target))) return; // свои изменения не считаем
      schedule();
    });
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'open', 'data-hint'] });
    const iv = window.setInterval(schedule, 700);
    schedule();
    return () => {
      cancelAnimationFrame(raf);
      mq.removeEventListener('change', onMq);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      mo.disconnect();
      window.clearInterval(iv);
    };
  }, [on, recompute]);

  // сменили экран — подсказка закрывается
  useEffect(() => setOpenId(null), [pathname]);

  const [slot, setSlot] = useState<Element | null>(null);
  useEffect(() => {
    document.body.classList.toggle('is-training', on);
    setSlot(on ? document.querySelector('[data-hint-slot]') : null);
    return () => document.body.classList.remove('is-training');
  }, [on, phone]);

  // только что включили обучение — сразу первая подсказка экрана
  useEffect(() => {
    if (!on || startedTour.current || !hits.length) return;
    // ждём, пока экран дорисуется (разделы подгружаются), и открываем первую подсказку экрана
    const t = window.setTimeout(() => {
      startedTour.current = true;
      setOpenId((cur) => cur ?? hitsRef.current[0]?.def.id ?? null);
    }, 450);
    return () => window.clearTimeout(t);
  }, [on, hits]);

  const hitsRef = useRef<Hit[]>([]);
  hitsRef.current = hits;
  const idx = hits.findIndex((h) => h.def.id === openId);
  const open = idx >= 0 ? hits[idx] : null;
  const shown = open && !open.off ? open : null;

  const go = (i: number) => {
    const h = hits[i];
    if (!h) return;
    if (open) markSeen(open.def.id);
    // элемент за краем экрана — докручиваем к нему, окно подсказки встанет, когда он покажется
    if (h.off) h.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setOpenId(h.def.id);
  };
  const close = () => {
    if (open) markSeen(open.def.id);
    setOpenId(null);
  };

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
      if (e.key === 'ArrowRight' && idx < hits.length - 1) go(idx + 1);
      if (e.key === 'ArrowLeft' && idx > 0) go(idx - 1);
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  });

  if (!on) return null;
  const unseen = hits.filter((h) => !seen.includes(h.def.id)).length;
  const layerOpen = document.querySelector('[data-layer-id]') !== null;
  // счётчик и «По шагам» — в шапке рядом со значком «Обучение», ничего на экране не закрывают
  const bar = slot
    ? createPortal(
        <span className="hint-slot-inner" role="status">
          {!phone ? (
            <span className="hint-slot-text">
              {hits.length ? `${hits.length} ${plural(hits.length)}${unseen && unseen < hits.length ? ` · новых ${unseen}` : ''}` : 'Подсказок на экране нет'}
            </span>
          ) : null}
          {hits.length ? (
            <button type="button" className="hint-slot-btn is-main" onClick={() => go(0)} title="Пройти подсказки экрана по шагам">
              {phone ? 'Шаги' : 'По шагам'}
            </button>
          ) : null}
          {seen.length && !phone ? (
            <button type="button" className="hint-slot-btn" onClick={resetSeen} title="Показать все подсказки как новые" aria-label="Показать все подсказки как новые">
              <RotateCcw size={16} />
            </button>
          ) : null}
        </span>,
        slot,
      )
    : null;

  const positions = placeBeacons(hits);

  return createPortal(
    <div className="hint-layer" ref={layerRef}>
      {bar}
      {shown ? <div className="hint-ring" style={{ left: shown.x - 5, top: shown.y - 5, width: shown.w + 10, height: shown.h + 10 }} /> : null}
      {hits.map((h, i) => {
        const p = positions[i];
        if (!p) return null;
        const isSeen = seen.includes(h.def.id);
        return (
          <button
            key={h.def.id}
            type="button"
            className={cx('hint-beacon', isSeen && 'is-seen', openId === h.def.id && 'is-open')}
            style={{ left: p.left, top: p.top }}
            aria-label={`Подсказка ${i + 1}: ${h.def.title}`}
            title={h.def.title}
            onClick={(e) => {
              e.stopPropagation();
              setOpenId(openId === h.def.id ? null : h.def.id);
            }}
          >
            {i + 1}
          </button>
        );
      })}
      {shown ? <HintPopover hit={shown} index={idx} total={hits.length} phone={phone} onPrev={() => go(idx - 1)} onNext={() => go(idx + 1)} onClose={close} /> : null}
      {/* открыто окно или карточка — шапка под ней, поэтому «По шагам» рядом, внизу слева (там затемнённый фон) */}
      {layerOpen && !phone && hits.length ? (
        <div className="hint-float" role="status">
          <span className="hint-slot-text">{hits.length} {plural(hits.length)}</span>
          <button type="button" className="hint-slot-btn is-main" onClick={() => go(0)}>
            По шагам
          </button>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

function plural(n: number): string {
  const a = n % 100;
  const b = n % 10;
  if (a > 10 && a < 20) return 'подсказок';
  if (b === 1) return 'подсказка';
  if (b > 1 && b < 5) return 'подсказки';
  return 'подсказок';
}

function HintPopover({ hit, index, total, phone, onPrev, onNext, onClose }: { hit: Hit; index: number; total: number; phone: boolean; onPrev: () => void; onNext: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const last = index === total - 1;

  // место для окна: под элементом, если не влезает — над ним; на телефоне — внизу экрана
  useLayoutEffect(() => {
    if (phone) {
      setPos(null);
      return;
    }
    const el = ref.current;
    const w = el?.offsetWidth ?? 320;
    const h = el?.offsetHeight ?? 160;
    let top = hit.y + hit.h + 12;
    if (top + h > window.innerHeight - 12) top = hit.y - h - 12;
    if (top < 12) top = Math.min(window.innerHeight - h - 12, Math.max(12, hit.y + 12));
    const left = Math.max(12, Math.min(window.innerWidth - w - 12, hit.x + hit.w / 2 - w / 2));
    setPos({ left, top });
  }, [hit.x, hit.y, hit.w, hit.h, phone, hit.def.id]);

  return (
    <div
      ref={ref}
      className={cx('hint-pop', phone && 'is-phone', phone && hit.y + hit.h / 2 > window.innerHeight / 2 && 'is-top')}
      role="dialog"
      aria-label={hit.def.title}
      style={phone ? undefined : { left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="hint-pop-head">
        <span className="hint-pop-step">
          {index + 1} из {total}
        </span>
        <button type="button" className="hint-pop-x" onClick={onClose} aria-label="Закрыть подсказку">
          <X size={16} />
        </button>
      </div>
      <div className="hint-pop-title">{hit.def.title}</div>
      <div className="hint-pop-text">{hit.def.text}</div>
      <div className="hint-pop-foot">
        {index > 0 ? (
          <button type="button" className="hint-pop-btn" onClick={onPrev}>
            <ArrowLeft size={16} />
            Назад
          </button>
        ) : (
          <span />
        )}
        {last ? (
          <button type="button" className="hint-pop-btn is-main" onClick={onClose}>
            <Check size={16} />
            Понятно
          </button>
        ) : (
          <button type="button" className="hint-pop-btn is-main" onClick={onNext}>
            Дальше
            <ArrowRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
