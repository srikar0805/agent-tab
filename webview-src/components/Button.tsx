import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/utils';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  children: ReactNode;
}

export function Button({ variant = 'primary', className, children, ...rest }: Props) {
  return (
    <button
      {...rest}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded px-3 py-1.5 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        variant === 'primary' && 'bg-btn-bg text-btn-fg hover:bg-btn-bg-hover',
        variant === 'secondary' &&
          'bg-btn-secondary-bg text-btn-secondary-fg hover:opacity-90',
        variant === 'ghost' && 'bg-transparent text-fg hover:bg-btn-secondary-bg',
        className,
      )}
    >
      {children}
    </button>
  );
}
