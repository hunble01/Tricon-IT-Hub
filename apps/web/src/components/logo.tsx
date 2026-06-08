import { cn } from "@/lib/utils";

/**
 * Tricon mark: a row of three gable rooftops — "Tri" + multi-family residential.
 * Drawn on an evergreen tile with a soft gradient.
 */
export function LogoMark({ className, size = 36 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="tri-tile" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
          <stop stopColor="#235C47" />
          <stop offset="1" stopColor="#163C2F" />
        </linearGradient>
      </defs>
      <rect width="36" height="36" rx="10" fill="url(#tri-tile)" />
      <path
        d="M6 23.5 L11 15 L16 23.5 L21 15 L26 23.5 L31 15"
        stroke="#FDFCFA"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M6.5 26.5 H29.5" stroke="#FDFCFA" strokeOpacity="0.45" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark size={34} />
      <div className="leading-none">
        <div className="font-display text-[17px] font-semibold tracking-tight text-ink">Tricon</div>
        <div className="font-mono text-[9.5px] font-medium uppercase tracking-[0.28em] text-ink-faint">
          IT&nbsp;Hub
        </div>
      </div>
    </div>
  );
}
