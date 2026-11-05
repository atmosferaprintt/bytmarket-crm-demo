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
  x: number; // прямоугольник элемента в окне
  y: number;
  w: number;
  h: number;
}

const PHONE_Q = '(max-width: 760px)';

function isPhone(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(PHONE_Q).matches;
}

/** Видимая часть элемента с учётом прокручиваемых родителей (таблица, боковая панель). null — не виден. */
function visibleRect(el: Element): DOMRect | null {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  const st = getComputedStyle(el);
  if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) return null;
  let top = r.top;
  let bottom = r.bottom;
  let left = r.left;
  let right = r.right;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (/(auto|scroll|hidden|clip)/.test(s.overflow + s.overflowX + s.overflowY)) {
      const pr = p.getBoundingClientRect();
      top = Math.max(top, pr.top);
      bottom = Math.min(bottom, pr.bottom);
      left = Math.max(left, pr.left);
      right = Math.min(right, pr.right);
      if (bottom - top < 2 || right - left < 2) return null;
    }
  }
  if (bottom < 0 || top > window.innerHeight || right < 0 || left > window.innerWidth) return null;
  return new DOMRect(left, top, right - left, bottom - top);
}

function matchesPath(def: HintDef, path: string): boolean {
  const list = Array.isArray(def.path) ? def.path : [def.path];
  return list.some((p) => p === '*' || p === path);
}

/** Что сейчас на экране: подсказки, у которых элемент виден. Сначала свои, потом общие (если элемент свободен). */
function collect(defs: HintDef[], root: Element): Hit[] {
  const used = new Set<Element>();
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
      const r = visibleRect(el);
      if (!r) continue;
      used.add(el);
      out.push({ def: d, x: r.left, y: r.top, w: r.width, h: r.height });
      break;
    }
  }
  // порядок шагов: сначала то, что на экране (подсказки раздела), потом общие (таблица, вкладки), в конце шапка и меню;
  // внутри группы — как читают: сверху вниз, слева направо
  const group = (h: Hit): number => (h.def.id.startsWith('shell.') ? 2 : h.def.generic ? 1 : 0);
  return out.sort((a, b) => group(a) - group(b) || (Math.abs(a.y - b.y) > 24 ? a.y - b.y : a.x - b.x));
}

/** Где поставить отметку: у кнопок и полей — над правым верхним углом, у больших блоков — над левым
    (справа у карточек и окон крестик закрытия, его не закрываем). */
function beaconPos(h: Hit): { left: number; top: number } {
  const big = h.w > 220 && h.h > 44;
  const left = big ? h.x - 10 : h.x + h.w - 12;
  const top = h.y - 12;
  return { left: Math.max(4, Math.min(window.innerWidth - 28, left)), top: Math.max(4, Math.min(window.innerHeight - 28, top)) };
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
  const startedTour = useRef(false);

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

  // только что включили обучение — сразу первая подсказка экрана
  useEffect(() => {
    if (on && !startedTour.current && hits.length) {
      startedTour.current = true;
      setOpenId(hits[0].def.id);
    }
  }, [on, hits]);

  const idx = hits.findIndex((h) => h.def.id === openId);
  const open = idx >= 0 ? hits[idx] : null;

  const go = (i: number) => {
    const h = hits[i];
    if (!h) return;
    if (open) markSeen(open.def.id);
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

  return createPortal(
    <div className="hint-layer" ref={layerRef}>
      {open ? <div className="hint-ring" style={{ left: open.x - 5, top: open.y - 5, width: open.w + 10, height: open.h + 10 }} /> : null}
      {hits.map((h, i) => {
        const p = beaconPos(h);
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
      {open ? <HintPopover hit={open} index={idx} total={hits.length} phone={phone} onPrev={() => go(idx - 1)} onNext={() => go(idx + 1)} onClose={close} /> : null}
      <div className={cx('hint-bar', phone && 'is-phone')} role="status" style={phone ? undefined : { left: (document.querySelector('.sidebar')?.getBoundingClientRect().right ?? 0) + 16 }}>
        <GraduationCap size={18} />
        <span className="grow">
          <span className="w-700">Обучение</span>
          <span className="muted"> · {hits.length ? `на этом экране ${hits.length} ${plural(hits.length)}${unseen && unseen < hits.length ? `, новых ${unseen}` : ''}` : 'на этом экране подсказок нет'}</span>
        </span>
        {hits.length ? (
          <button type="button" className="hint-bar-btn is-main" onClick={() => setOpenId(hits[0].def.id)}>
            По шагам
          </button>
        ) : null}
        {seen.length ? (
          <button type="button" className="hint-bar-btn" onClick={resetSeen} title="Показать все подсказки как новые" aria-label="Показать все подсказки как новые">
            <RotateCcw size={16} />
          </button>
        ) : null}
        <button type="button" className="hint-bar-btn" onClick={() => setTraining(false)} title="Выключить обучение" aria-label="Выключить обучение">
          <X size={16} />
        </button>
      </div>
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
      className={cx('hint-pop', phone && 'is-phone')}
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
