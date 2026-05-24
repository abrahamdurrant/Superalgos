import Link from "next/link";

export function Mark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="mg-fill" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#A855F7" />
          <stop offset="1" stopColor="#6D28D9" />
        </linearGradient>
        <linearGradient id="mg-stroke" x1="8" y1="8" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#EDE3FF" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="8.5" fill="url(#mg-fill)" />
      <rect
        x="1"
        y="1"
        width="30"
        height="30"
        rx="8.5"
        stroke="white"
        strokeOpacity="0.18"
      />
      {/* Bold M drawn as ascending peaks — growth + empire */}
      <path
        d="M8 23 L8 10 L16 18 L24 10 L24 23"
        stroke="url(#mg-stroke)"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({
  size = 30,
  href = "/",
  className = "",
}: {
  size?: number;
  href?: string | null;
  className?: string;
}) {
  const inner = (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Mark size={size} />
      <span className="text-[1.15rem] font-semibold tracking-tight text-white">
        Magnate
      </span>
    </span>
  );
  if (href === null) return inner;
  return (
    <Link href={href} className="group">
      {inner}
    </Link>
  );
}
