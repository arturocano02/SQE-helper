import React from 'react'

interface IconProps {
  size?: number
  className?: string
}

const base = (size: number, children: React.ReactNode) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
)

export const HomeIcon = ({ size = 20, className = '' }: IconProps) => (
  <span className={className}>{base(size,
    <><path d="M3 9.5L10 3l7 6.5V17a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"/><path d="M7 18v-6h6v6"/></>
  )}</span>
)

export const DrillIcon = ({ size = 20, className = '' }: IconProps) => (
  <span className={className}>{base(size,
    <><circle cx="10" cy="10" r="7"/><path d="M10 7v3l2 2"/></>
  )}</span>
)

export const RecallIcon = ({ size = 20, className = '' }: IconProps) => (
  <span className={className}>{base(size,
    <><rect x="3" y="4" width="14" height="12" rx="2"/><path d="M7 8h6M7 11h4"/></>
  )}</span>
)

export const ProgressIcon = ({ size = 20, className = '' }: IconProps) => (
  <span className={className}>{base(size,
    <><path d="M3 15l4-5 4 3 4-6"/><path d="M3 17h14"/></>
  )}</span>
)

export const ProfileIcon = ({ size = 20, className = '' }: IconProps) => (
  <span className={className}>{base(size,
    <><circle cx="10" cy="7" r="3"/><path d="M4 17c0-3.314 2.686-6 6-6s6 2.686 6 6"/></>
  )}</span>
)

export const UploadIcon = ({ size = 20, className = '' }: IconProps) => (
  <span className={className}>{base(size,
    <><path d="M10 13V4M6 8l4-4 4 4"/><path d="M3 14v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2"/></>
  )}</span>
)

export const QuestionIcon = ({ size = 20, className = '' }: IconProps) => (
  <span className={className}>{base(size,
    <><circle cx="10" cy="10" r="7"/><path d="M10 14v-1"/><path d="M10 11c0-1.5 2-2.5 2-4a2 2 0 0 0-4 0"/></>
  )}</span>
)

export const CheckIcon = ({ size = 20, className = '' }: IconProps) => (
  <span className={className}>{base(size,
    <path d="M4 10l4 4 8-8"/>
  )}</span>
)

export const CloseIcon = ({ size = 20, className = '' }: IconProps) => (
  <span className={className}>{base(size,
    <><path d="M5 5l10 10M15 5L5 15"/></>
  )}</span>
)

export const ArrowRightIcon = ({ size = 20, className = '' }: IconProps) => (
  <span className={className}>{base(size,
    <><path d="M4 10h12M12 6l4 4-4 4"/></>
  )}</span>
)

export const AdminIcon = ({ size = 20, className = '' }: IconProps) => (
  <span className={className}>{base(size,
    <><path d="M10 2l2.4 4.8L18 8l-4 3.9.9 5.6L10 15l-4.9 2.5.9-5.6L2 8l5.6-.7L10 2z"/></>
  )}</span>
)

export const SignOutIcon = ({ size = 20, className = '' }: IconProps) => (
  <span className={className}>{base(size,
    <><path d="M13 15l4-5-4-5"/><path d="M17 10H7"/><path d="M7 3H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h3"/></>
  )}</span>
)

export const BookIcon = ({ size = 20, className = '' }: IconProps) => (
  <span className={className}>{base(size,
    <><path d="M4 3h10a1 1 0 0 1 1 1v13l-3-2-3 2-3-2-3 2V4a1 1 0 0 1 1-1z"/></>
  )}</span>
)
