import type { ButtonHTMLAttributes } from 'react'

export interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: 'danger' | 'primary' | 'secondary'
}

const variants = {
  danger:
    'border-destructive-800/80 bg-destructive-950/70 text-destructive-200 hover:bg-destructive-900/70',
  primary: 'border-brand-500 bg-brand-600 text-primary-foreground hover:bg-brand-500',
  secondary: 'border-brand-800 bg-background text-brand-200 hover:bg-brand-950/70',
} as const

export const ActionButton = ({
  className,
  variant = 'primary',
  type = 'button',
  ...props
}: ActionButtonProps) => (
  <button
    // ComponentProps restricts type to button, submit, or reset, and defaults to button.
    // oxlint-disable-next-line react/button-has-type
    type={type}
    className={[
      'rounded-sm border px-4 py-2 text-sm font-bold transition-colors',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400',
      'disabled:cursor-not-allowed disabled:opacity-50',
      variants[variant],
      className,
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)
