import Link from "next/link";
import { Logo } from "./Logo";

const LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/#team", label: "The team" },
  { href: "/#compare", label: "Why Magnate" },
  { href: "/pricing", label: "Pricing" },
];

export function SiteNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/8 bg-ink/70 backdrop-blur-xl">
      <div className="container-x flex h-16 items-center justify-between">
        <Logo />
        <nav className="hidden items-center gap-7 md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-sm text-mist transition-colors hover:text-white"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="hidden text-sm text-mist hover:text-white sm:inline">
            Sign in
          </Link>
          <Link href="/dashboard" className="btn-primary">
            Build your empire
          </Link>
        </div>
      </div>
    </header>
  );
}
