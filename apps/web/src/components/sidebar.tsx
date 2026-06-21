"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Laptop,
  UserPlus,
  UserMinus,
  Ticket,
  ListChecks,
  SlidersHorizontal,
  Sparkles,
  MessageCircleQuestion,
  Receipt,
  ClipboardCheck,
  Plug,
  Bell,
  Newspaper,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { clearSession, type SessionUser } from "@/lib/session";
import { cn } from "@/lib/utils";
import { Wordmark } from "./logo";

const AUTH_DISABLED = process.env.NEXT_PUBLIC_AUTH_DISABLED === "true";

const NAV: Array<{ href: string; label: string; icon: LucideIcon; accent?: boolean }> = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/ask", label: "Ask the Hub", icon: MessageCircleQuestion, accent: true },
  { href: "/briefing", label: "Daily Briefing", icon: Newspaper },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/intake", label: "Smart Intake", icon: Sparkles, accent: true },
  { href: "/tasks", label: "Tasks", icon: ListChecks },
  { href: "/staff", label: "Staff", icon: Users },
  { href: "/devices", label: "Devices", icon: Laptop },
  { href: "/procurement", label: "Procurement", icon: Receipt },
  { href: "/audit", label: "Site Audit", icon: ClipboardCheck },
  { href: "/onboarding", label: "Onboarding", icon: UserPlus },
  { href: "/offboarding", label: "Offboarding", icon: UserMinus },
  { href: "/tickets", label: "Tickets", icon: Ticket },
  { href: "/connections", label: "Connections", icon: Plug },
  { href: "/admin", label: "Admin", icon: SlidersHorizontal },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function Sidebar({
  user,
  open = false,
  onClose,
}: {
  user: SessionUser;
  open?: boolean;
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();

  function logout() {
    clearSession();
    router.push("/login");
  }

  return (
    <>
      {/* Mobile backdrop — tap to dismiss. Hidden on lg. */}
      <div
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-40 bg-ink/40 backdrop-blur-sm transition-opacity lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-screen w-[252px] shrink-0 flex-col border-r border-line bg-surface backdrop-blur-sm transition-transform duration-200",
          "lg:sticky lg:top-0 lg:z-30 lg:translate-x-0 lg:bg-surface/80",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="px-5 pb-5 pt-6">
          <Link href="/" onClick={onClose} className="inline-block transition-opacity hover:opacity-80">
            <Wordmark />
          </Link>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
          <p className="eyebrow px-3 pb-2 pt-2">Workspace</p>
          {NAV.map((item) => {
            const active =
              pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "group relative flex items-center gap-3 rounded-field px-3 py-2 text-sm transition",
                  active
                    ? "bg-accent-wash font-medium text-accent-ink"
                    : "text-ink-soft hover:bg-paper-deep/50 hover:text-ink",
                )}
              >
              {active && (
                <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-accent" />
              )}
              <Icon
                size={17}
                strokeWidth={2}
                className={cn(
                  "transition",
                  active ? "text-accent" : "text-ink-faint group-hover:text-ink-soft",
                )}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-3 p-3">
        {AUTH_DISABLED && (
          <div className="flex items-center gap-2 rounded-field border border-honey/30 bg-honey-wash px-3 py-2">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-honey" />
            <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-honey">
              Demo · no auth
            </span>
          </div>
        )}
        <div className="flex items-center gap-3 rounded-card border border-line bg-surface-raised p-2.5 shadow-soft">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-accent font-mono text-xs font-semibold text-white">
            {initials(user.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-ink">{user.name}</div>
            <div className="truncate font-mono text-[10px] uppercase tracking-wider text-ink-faint">
              {user.role}
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            title="Sign out"
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition hover:bg-paper-deep hover:text-clay"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
      </aside>
    </>
  );
}
