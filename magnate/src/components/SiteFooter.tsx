import Link from "next/link";
import { Logo } from "./Logo";

export function SiteFooter() {
  return (
    <footer className="border-t border-white/8 bg-ink-900">
      <div className="container-x py-14">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm text-mist-dim">
              The operating system for the one-person company. Your AI CEO and a
              team that does the work.
            </p>
          </div>
          <FooterCol
            title="Product"
            links={[
              ["How it works", "/#how"],
              ["The team", "/#team"],
              ["Pricing", "/pricing"],
              ["Open the app", "/dashboard"],
            ]}
          />
          <FooterCol
            title="Company"
            links={[
              ["About", "/#"],
              ["Careers", "/#"],
              ["Blog", "/#"],
              ["Contact", "/#"],
            ]}
          />
          <FooterCol
            title="Legal"
            links={[
              ["Privacy", "/#"],
              ["Terms", "/#"],
              ["Security", "/#"],
            ]}
          />
        </div>
        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-white/8 pt-6 text-xs text-mist-dim sm:flex-row sm:items-center">
          <p>© {new Date().getFullYear()} Magnate. A demonstration product.</p>
          <p>Built with Next.js · Powered by Claude</p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-white">{title}</h4>
      <ul className="mt-3 space-y-2">
        {links.map(([label, href]) => (
          <li key={label}>
            <Link href={href} className="text-sm text-mist-dim transition-colors hover:text-white">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
