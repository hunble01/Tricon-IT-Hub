"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getSessionUser, type SessionUser } from "@/lib/session";

interface Props {
  children: (user: SessionUser) => React.ReactNode;
}

// Dev escape hatch: when NEXT_PUBLIC_AUTH_DISABLED=true, skip the login gate and
// render as a stub admin. The backend mirrors this with AUTH_DISABLED. Off by
// default — flip both flags off to restore the real login flow.
const AUTH_DISABLED = process.env.NEXT_PUBLIC_AUTH_DISABLED === "true";
const DEV_USER: SessionUser = {
  userId: "dev",
  email: "dev@tricon.local",
  name: "Dev Admin",
  role: "ADMIN",
};

export function AuthGuard({ children }: Props) {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(AUTH_DISABLED ? DEV_USER : null);
  const [checked, setChecked] = useState(AUTH_DISABLED);

  useEffect(() => {
    if (AUTH_DISABLED) return;
    const u = getSessionUser();
    if (!u) {
      router.replace("/login");
      return;
    }
    setUser(u);
    setChecked(true);
  }, [router]);

  if (!checked || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-neutral-500">
        Loading…
      </div>
    );
  }
  return <>{children(user)}</>;
}
