/* Мелкие детали документов: вид с иконкой, маршрут «откуда → куда» иконкой. */
import { ArrowLeftRight, ArrowRight, Boxes, ClipboardCheck, PackagePlus, Trash2, Truck } from 'lucide-react';
import type { LocationKey } from '../../data/types';
import { IconTile } from '../../ui';
import { DOC_KIND_NAMES, placeName } from './calc';
import type { DocRowKind } from './docRows';

export function DocIcon({ kind }: { kind: DocRowKind }) {
  const map = {
    income: { i: <PackagePlus />, t: 'ok' as const },
    receive: { i: <Truck />, t: 'ok' as const },
    transfer: { i: <ArrowLeftRight />, t: 'info' as const },
    writeoff: { i: <Trash2 />, t: 'bad' as const },
    count: { i: <ClipboardCheck />, t: undefined },
    initial: { i: <Boxes />, t: undefined },
  }[kind];
  return <IconTile tone={map.t}>{map.i}</IconTile>;
}

export function DocKind({ kind }: { kind: DocRowKind }) {
  return (
    <span className="stock-doc-kind">
      <DocIcon kind={kind} />
      {DOC_KIND_NAMES[kind]}
    </span>
  );
}

export function Route({ kind, from, to }: { kind: DocRowKind; from: LocationKey | null; to: LocationKey | null }) {
  if (kind === 'transfer')
    return (
      <span className="stock-route">
        {placeName(from)}
        <ArrowRight />
        {placeName(to)}
      </span>
    );
  return <span className="stock-route">{placeName(to ?? from)}</span>;
}
