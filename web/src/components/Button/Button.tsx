import styles from './Button.module.css'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost'
  size?: 'sm' | 'md' | 'icon'
}

export default function Button({ variant = 'primary', size = 'md', className, children, ...props }: ButtonProps) {
  return (
    <button
      className={[styles.button, styles[variant], styles[`size-${size}`], className].filter(Boolean).join(' ')}
      {...props}
    >
      {children}
    </button>
  )
}
