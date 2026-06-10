interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeClasses = {
  sm: 'w-4 h-4 border-2',
  md: 'w-6 h-6 border-2',
  lg: 'w-10 h-10 border-2',
}

export default function LoadingSpinner({ size = 'md', className = '' }: LoadingSpinnerProps) {
  return (
    <div
      style={{ borderColor: 'var(--amber)', borderTopColor: 'transparent' }}
      className={`${sizeClasses[size]} rounded-full animate-spin ${className}`}
      aria-label="Loading"
    />
  )
}
