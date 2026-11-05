/* «Задача выполнена · Отменить» — теперь это общее сообщение с действием (toast из ui), без своей копии. */
import { toast } from '../../ui';

/** Показать сообщение с «Отменить» на 6 секунд. */
export function undoToast(text: string, onUndo: () => void): void {
  toast(text, 'ok', { label: 'Отменить', onClick: onUndo });
}

/** Раньше показывало своё сообщение; общий toast справляется сам. */
export function UndoToastHost() {
  return null;
}
