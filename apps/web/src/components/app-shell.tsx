"use client";

import * as React from "react";
import { Menu } from "lucide-react";
import { AuthGuard } from "@/components/auth-guard";
import { Sidebar } from "@/components/sidebar";
import type { SessionUser } from "@/lib/session";

interface Props {
  eyebrow?: string;
  title: React.ReactNode;
  actions?: React.ReactNode;
  children: (user: SessionUser) => React.ReactNode;
}

export function AppShell({ eyebrow, title, actions, children }: Props) {
  return (
    <AuthGuard>
      {(user) => (
        <ShellBody user={user} eyebrow={eyebrow} title={title} actions={actions}>
          {children}
        </ShellBody>
      )}
    </AuthGuard>
  );
}

function ShellBody({ user, eyebrow, title, actions, children }: Props & { user: SessionUser }) {
  // Drawer state drives the sidebar on small screens; static on lg+.
  const [navOpen, setNavOpen] = React.useState(false);

  return (
    <div className="relative z-10 flex min-h-screen">
      <Sidebar user={user} open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          eyebrow={eyebrow}
          title={title}
          actions={actions}
          onMenu={() => setNavOpen(true)}
        />
        <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 sm:px-8 sm:py-8">
          {children(user)}
        </main>
      </div>
    </div>
  );
}

function Topbar({
  eyebrow,
  title,
  actions,
  onMenu,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  actions?: React.ReactNode;
  onMenu: () => void;
}) {
  const [today, setToday] = React.useState("");
  React.useEffect(() => {
    setToday(
      new Date().toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      }),
    );
  }, []);

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/70 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between gap-3 px-4 py-3.5 sm:px-8 sm:py-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onMenu}
            aria-label="Open menu"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-field text-ink-soft transition hover:bg-paper-deep/60 lg:hidden"
          >
            <Menu size={20} />
          </button>
          <div className="min-w-0">
            {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
            <h1 className="truncate text-xl font-semibold leading-none text-ink sm:text-[26px]">
              {title}
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {actions}
          <span className="hidden font-mono text-[11px] uppercase tracking-wider text-ink-faint sm:block">
            {today}
          </span>
        </div>
      </div>
    </header>
  );
}
