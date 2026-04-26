import { cn } from '@/lib/utils';
import { type VariantProps, cva } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { type ButtonHTMLAttributes, forwardRef } from 'react';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-transparent font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        default:
          'bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover,var(--color-accent))] hover:brightness-110',
        outline:
          'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]',
        ghost:
          'bg-transparent text-gray-500 hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]',
        subtle:
          'bg-[var(--color-surface-2)] text-gray-600 hover:bg-[var(--color-border)] hover:text-[var(--color-fg)]',
        danger: 'border-red-200 bg-red-50 text-red-700 hover:border-red-300 hover:bg-red-100',
      },
      size: {
        default: 'h-9 px-4 text-sm',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-10 px-5 text-sm',
        icon: 'h-9 w-9 p-0',
        iconSm: 'h-8 w-8 p-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || loading}
      aria-busy={loading}
      {...props}
    >
      {loading && (
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} aria-hidden="true" />
      )}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';
