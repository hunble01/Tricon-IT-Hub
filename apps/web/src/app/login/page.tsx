"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { api, ApiError } from "@/lib/api";
import { setSession, type SessionUser } from "@/lib/session";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api<{ token: string; user: SessionUser }>("/auth/login", {
        method: "POST",
        body: { email, password },
      });
      setSession(res.token, res.user);
      router.push("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative z-10 grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-accent-ink lg:flex lg:flex-col lg:justify-between lg:p-12">
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full text-white/[0.04]"
          viewBox="0 0 600 800"
          fill="none"
          aria-hidden="true"
          preserveAspectRatio="xMidYMid slice"
        >
          {Array.from({ length: 9 }).map((_, r) => (
            <path
              key={r}
              d={`M${-100 + r * 80} 800 L${120 + r * 80} 200 L${340 + r * 80} 800`}
              stroke="currentColor"
              strokeWidth="2"
            />
          ))}
        </svg>
        <div className="absolute right-0 top-0 h-96 w-96 rounded-full bg-accent-bright/20 blur-3xl" />

        <div className="relative flex items-center gap-3">
          <LogoMark size={40} />
          <div className="leading-none">
            <div className="font-display text-lg font-semibold text-white">Tricon</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/50">IT Hub</div>
          </div>
        </div>

        <div className="relative">
          <h1 className="max-w-md font-display text-[40px] font-semibold leading-[1.1] text-white">
            The operations hub for residential IT.
          </h1>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/60">
            Staff, devices, onboarding, and ticket intelligence — for the teams that keep every
            building running.
          </p>
        </div>

        <div className="relative font-mono text-[11px] uppercase tracking-wider text-white/40">
          Toronto · Multi-family residential
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center px-6 py-12">
        <form onSubmit={onSubmit} className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <LogoMark size={38} />
          </div>
          <p className="eyebrow mb-2">Welcome back</p>
          <h2 className="font-display text-3xl font-semibold text-ink">Sign in</h2>
          <p className="mt-2 text-sm text-ink-soft">Access the Tricon IT operations hub.</p>

          <label className="mt-8 block text-[13px] font-medium text-ink-soft">
            Email address
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@tricon.local"
              className="field mt-1.5"
            />
          </label>
          <label className="mt-4 block text-[13px] font-medium text-ink-soft">
            Password
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="field mt-1.5"
            />
          </label>

          {error && (
            <div className="mt-4 rounded-field border border-clay/30 bg-clay-wash px-3 py-2 text-sm text-clay">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} className="btn-primary mt-6 w-full py-2.5">
            {loading ? "Signing in…" : "Sign in"}
            {!loading && <ArrowRight size={16} />}
          </button>

          <p className="mt-6 text-center font-mono text-[11px] text-ink-faint">
            admin@tricon.local · change-me-now
          </p>
        </form>
      </div>
    </main>
  );
}
