import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[calc(var(--radius)*0.8)] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'border border-[var(--border)] bg-[var(--secondary)] text-[var(--secondary-foreground)] [border-style:var(--border-style)] hover:bg-[var(--muted)]',
        primary:
          'bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90',
        danger:
          'border border-[var(--border)] bg-[var(--secondary)] text-[var(--destructive)] [border-style:var(--border-style)] hover:border-[var(--destructive)] hover:bg-[var(--destructive)] hover:text-[var(--destructive-foreground)]',
        ghost:
          'text-[var(--foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]'
      },
      size: {
        default: 'h-[var(--control-height)] px-4 py-2',
        sm: 'h-8 rounded-md px-3',
        lg: 'h-10 rounded-md px-8',
        icon: 'h-9 w-9'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button };
