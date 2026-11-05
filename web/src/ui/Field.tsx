import { forwardRef, useEffect, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Minus, Plus, Search, X } from 'lucide-react';
import { cx } from './cx';

/** Подпись, поле, подсказка и ошибка. */
export function Field({ label, hint, error, children, className }: { label?: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('field', className)}>
      {label ? <span className="field-label">{label}</span> : null}
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'sm' | 'md' | 'lg';
  invalid?: boolean;
  icon?: ReactNode;
  suffix?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ size = 'md', invalid, icon, suffix, className, ...rest }, ref) {
  const input = (
    <input
      ref={ref}
      className={cx('input', size === 'sm' && 'input-sm', size === 'lg' && 'input-lg', invalid && 'is-invalid', className)}
      {...rest}
    />
  );
  if (!icon && !suffix) return input;
  return (
    <span className={cx('input-wrap', icon ? 'has-icon' : undefined)}>
      {input}
      {icon}
      {suffix ? <span className="input-suffix">{suffix}</span> : null}
    </span>
  );
});

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & { options: SelectOption[]; size?: 'sm' | 'md'; placeholder?: string }>(
  function Select({ options, size = 'md', placeholder, className, ...rest }, ref) {
    return (
      <select ref={ref} className={cx('select', size === 'sm' && 'select-sm', className)} {...rest}>
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx('textarea', className)} {...rest} />;
});

/** Поле поиска с иконкой и крестиком очистки. */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Поиск',
  size = 'md',
  autoFocus,
  className,
  onKeyDown,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  size?: 'sm' | 'md' | 'lg';
  autoFocus?: boolean;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  return (
    <span className={cx('input-wrap', 'has-icon', className)}>
      <input
        ref={inputRef}
        className={cx('input', size === 'sm' && 'input-sm', size === 'lg' && 'input-lg')}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        style={value ? { paddingRight: 34 } : undefined}
      />
      <Search className={size === 'lg' ? 'is-lg' : undefined} />
      {value ? (
        <button type="button" className="input-clear" aria-label="Очистить" onClick={() => onChange('')}>
          <X />
        </button>
      ) : null}
    </span>
  );
}

export function Checkbox({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children?: ReactNode; disabled?: boolean }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

/** Количество с кнопками − / + и вводом с клавиатуры. */
export function QtyInput({ value, onChange, min = 0, max, step = 1, ariaLabel = 'Количество' }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; ariaLabel?: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const clamp = (v: number) => Math.max(min, max !== undefined ? Math.min(max, v) : v);
  return (
    <span className="qty">
      <button type="button" aria-label="Меньше" onClick={() => onChange(clamp(value - step))} disabled={value <= min}>
        <Minus />
      </button>
      <input
        aria-label={ariaLabel}
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ''))}
        onBlur={() => {
          const v = clamp(Number(text || 0));
          setText(String(v));
          if (v !== value) onChange(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp') { e.preventDefault(); onChange(clamp(value + step)); }
          if (e.key === 'ArrowDown') { e.preventDefault(); onChange(clamp(value - step)); }
        }}
      />
      <button type="button" aria-label="Больше" onClick={() => onChange(clamp(value + step))} disabled={max !== undefined && value >= max}>
        <Plus />
      </button>
    </span>
  );
}

/** Ввод суммы в рублях (целые). */
export const MoneyInput = forwardRef<HTMLInputElement, { value: number | ''; onChange: (v: number | '') => void; placeholder?: string; size?: 'sm' | 'md' | 'lg'; autoFocus?: boolean; invalid?: boolean; onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void; ariaLabel?: string }>(function MoneyInput(
  { value, onChange, placeholder, size = 'md', autoFocus, invalid, onKeyDown, ariaLabel },
  ref,
) {
  return (
    <span className="input-wrap">
      <input
        ref={ref}
        onKeyDown={onKeyDown}
        aria-label={ariaLabel}
        className={cx('input', 'num', size === 'sm' && 'input-sm', size === 'lg' && 'input-lg', invalid && 'is-invalid')}
        inputMode="numeric"
        autoFocus={autoFocus}
        value={value === '' ? '' : String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}
        placeholder={placeholder}
        onChange={(e) => {
          const digits = e.target.value.replace(/[^\d]/g, '');
          onChange(digits === '' ? '' : Number(digits));
        }}
        style={{ paddingRight: 30 }}
      />
      <span className="input-suffix">₽</span>
    </span>
  );
});
