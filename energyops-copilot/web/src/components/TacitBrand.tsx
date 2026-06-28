interface TacitBrandProps {
  markSize?: number;
  className?: string;
}

export function TacitBrand({ markSize = 28, className = '' }: TacitBrandProps) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg
        width={markSize}
        height={markSize}
        viewBox="0 0 64 64"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <path
          d="M42 14.7 A20 20 0 1 1 22 14.7"
          stroke="var(--primary)"
          strokeWidth="6"
          strokeLinecap="round"
          fill="none"
        />
        <path d="M30 10.2 L24.2 19.2 L18.8 10.6 Z" fill="var(--accent)" />
        <circle cx="32" cy="32" r="6.5" fill="var(--accent)" />
      </svg>
      <span className="font-display text-[18px] font-semibold leading-none">
        Tacit
      </span>
    </span>
  );
}
