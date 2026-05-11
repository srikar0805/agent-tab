import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

interface CardProps {
  className?: string;
  children: ReactNode;
}

export function Card({ className, children }: CardProps) {
  return (
    <div
      className={cn('rounded border border-border bg-card p-3', className)}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className }: CardProps) {
  return (
    <div className={cn('mb-2 flex items-center justify-between', className)}>{children}</div>
  );
}

export function CardTitle({ children, className }: CardProps) {
  return (
    <h3 className={cn('text-sm font-semibold tracking-tight text-fg', className)}>
      {children}
    </h3>
  );
}
