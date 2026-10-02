import { clsx } from 'clsx';
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, ReactElement, OptionHTMLAttributes } from 'react';
import { Children, isValidElement, useEffect, useRef, useState } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';

export function Button({
  children,
  variant = 'default',
  size = 'md',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'outline';
  size?: 'sm' | 'md' | 'icon';
}) {
  return (
    <button
      type="button"
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed select-none',
        size === 'sm' && 'min-h-10 px-3 text-xs',
        size === 'md' && 'min-h-11 px-4 text-sm',
        size === 'icon' && 'h-11 w-11 shrink-0',
        variant === 'default' && 'bg-ink-700 text-ink-100 hover:bg-ink-600',
        variant === 'primary' && 'bg-accent-500 text-ink-950 hover:bg-accent-400',
        variant === 'ghost' && 'text-ink-300 hover:bg-ink-750 hover:text-ink-100',
        variant === 'outline' && 'border border-ink-600 text-ink-200 hover:bg-ink-750',
        variant === 'danger' && 'bg-red-900/70 text-red-100 hover:bg-red-800',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Panel({ title, children, right, className }: { title?: string; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={clsx('rounded-lg border border-ink-700 bg-ink-850', className)}>
      {title && (
        <div className="flex items-center justify-between border-b border-ink-700 px-3 py-2">
          <div className="text-xs font-semibold text-ink-300">{title}</div>
          {right}
        </div>
      )}
      <div className="p-3">{children}</div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="text-xxs text-ink-400">{label}</span>
        {hint && <span className="text-xxs text-ink-500">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

export function NumberInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="number"
      className={clsx(
        'h-11 w-full rounded-xl border border-ink-600 bg-ink-900 px-3 text-sm text-ink-100 focus:border-accent-500',
        className
      )}
      {...rest}
    />
  );
}

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={clsx(
        'h-11 w-full rounded-xl border border-ink-600 bg-ink-900 px-3 text-sm text-ink-100 placeholder:text-ink-500 focus:border-accent-500',
        className
      )}
      {...rest}
    />
  );
}

type SelectProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'value' | 'defaultValue' | 'onChange'> & {
  value?: string | number;
  defaultValue?: string | number;
  required?: boolean;
  onChange?: (event: { target: { value: string } }) => void;
};

/** Shared single-select; keeps option markup and value callbacks consistent across pages. */
export function Select({ className, children, value, defaultValue, onChange, disabled, name, required, ...rest }: SelectProps) {
  const options = Children.toArray(children).filter((child): child is ReactElement<OptionHTMLAttributes<HTMLOptionElement>> => isValidElement(child) && child.type === 'option');
  const [localValue, setLocalValue] = useState(String(defaultValue ?? options[0]?.props.value ?? ''));
  const selected = String(value ?? localValue);
  // Prefix values so the valid empty-string choice ("follow overall") remains selectable.
  const encode = (v: string | number | readonly string[] | undefined) => `option:${String(v ?? '')}`;
  return (
    <SelectPrimitive.Root value={encode(selected)} disabled={disabled} required={required} onValueChange={(next) => {
      const nextValue = next.slice('option:'.length);
      setLocalValue(nextValue);
      onChange?.({ target: { value: nextValue } });
    }}>
      {name && <input type="hidden" name={name} value={selected} disabled={disabled} />}
      <SelectPrimitive.Trigger {...rest} className={clsx('ui-select-trigger', className)}>
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon className="ui-select-chevron"><ChevronDown size={15} /></SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className="ui-select-content" position="popper" sideOffset={6} collisionPadding={10}>
          <SelectPrimitive.ScrollUpButton className="ui-select-scroll"><ChevronUp size={14} /></SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="ui-select-viewport">
            {options.map((option) => <SelectPrimitive.Item key={encode(option.props.value)} value={encode(option.props.value)} disabled={option.props.disabled} className="ui-select-item">
              <SelectPrimitive.ItemText>{option.props.children}</SelectPrimitive.ItemText>
              <SelectPrimitive.ItemIndicator className="ui-select-check"><Check size={15} strokeWidth={2} /></SelectPrimitive.ItemIndicator>
            </SelectPrimitive.Item>)}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="ui-select-scroll"><ChevronDown size={14} /></SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export function Slider({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="range"
      className={clsx('h-1.5 w-full cursor-pointer appearance-none rounded bg-ink-600 accent-accent-500', className)}
      {...rest}
    />
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-1 py-1.5 text-sm text-ink-200 hover:bg-ink-750"
    >
      <span>{label}</span>
      <span className={clsx('relative h-4 w-8 rounded-full transition-colors', checked ? 'bg-accent-500' : 'bg-ink-600')}>
        <span
          className={clsx(
            'absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all',
            checked ? 'left-4.5 translate-x-0' : 'left-0.5'
          )}
          style={{ left: checked ? 18 : 2 }}
        />
      </span>
    </button>
  );
}

export function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'warn' | 'ok' | 'err' }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded px-1.5 py-0.5 text-xxs font-medium',
        tone === 'default' && 'bg-ink-700 text-ink-300',
        tone === 'warn' && 'bg-amber-100 text-amber-900',
        tone === 'ok' && 'bg-emerald-100 text-emerald-900',
        tone === 'err' && 'bg-red-100 text-red-900'
      )}
    >
      {children}
    </span>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  wide
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const root = dialogRef.current;
    root?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); closeRef.current(); }
      if (event.key !== 'Tab' || !root) return;
      const focusable = [...root.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, a[href], [tabindex="0"]')].filter((el) => el.getClientRects().length);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root)) { event.preventDefault(); first.focus(); }
    };
    root?.addEventListener('keydown', onKey);
    return () => { root?.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className={clsx('flex max-h-[92vh] w-full flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-900 shadow-2xl', wide ? 'max-w-4xl' : 'max-w-lg')}>
        <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
          <div className="text-sm font-semibold text-ink-100">{title}</div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭">
            ✕
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-ink-600 bg-ink-900 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'min-h-10 rounded-lg px-3 py-2 text-sm transition-colors duration-150',
            value === o.value ? 'bg-ink-600 text-ink-100' : 'text-ink-400 hover:text-ink-200'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 可折叠分区（带高度过渡动画） */
export function Collapse({
  title,
  children,
  defaultOpen = true,
  right,
  accent
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  right?: ReactNode;
  accent?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-lg border border-ink-700 bg-ink-850">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2.5 transition-colors hover:bg-ink-800"
      >
        <span className={clsx('text-xs font-semibold', accent ? 'text-accent-400' : 'text-ink-300')}>{title}</span>
        <span className="flex items-center gap-2">
          {right}
          <svg
            viewBox="0 0 12 12"
            className={clsx('h-3 w-3 text-ink-500 transition-transform duration-200', open && 'rotate-180')}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <path d="M2.5 4.5 L6 8 L9.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      <div
        className={clsx(
          'grid transition-all duration-200 ease-out',
          open ? 'grid-rows-[1fr] opacity-100' : 'hidden'
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="border-t border-ink-700 p-3">{children}</div>
        </div>
      </div>
    </div>
  );
}
