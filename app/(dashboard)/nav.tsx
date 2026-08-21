"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/projects", label: "Projects" },
  { href: "/forms", label: "Forms" },
  { href: "/responses", label: "Responses" },
  { href: "/analysis", label: "Analysis" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav
      className="border-b px-8 py-3 flex items-center gap-1 sticky top-0 z-10"
      style={{ borderColor: "var(--line)", background: "var(--paper)" }}
    >
      <span
        className="text-sm font-semibold mr-4"
        style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
      >
        Observ
      </span>
      {LINKS.map((link) => {
        // /forms should also read as active for /forms/[formId] and
        // /forms/[formId]/collect -- a simple equality check would miss
        // every nested route under it.
        const isActive =
          pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            className="px-3 py-1.5 rounded-sm text-sm transition-colors"
            style={{
              color: isActive ? "var(--ink)" : "#8a8375",
              background: isActive ? "var(--paper-raised)" : "transparent",
              fontWeight: isActive ? 500 : 400,
            }}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
