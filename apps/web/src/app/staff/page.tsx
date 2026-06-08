"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import {
  Pill,
  SectionCard,
  EmptyState,
  ErrorNote,
  employmentBadge,
  sourceBadge,
} from "@/components/ui";
import { api, ApiError } from "@/lib/api";

interface Building {
  id: string;
  name: string;
}
interface Role {
  id: string;
  title: string;
}
interface Staff {
  id: string;
  fullName: string;
  firstName: string;
  lastName: string;
  adPrefix: string | null;
  employmentStatus: "ONBOARDING" | "ACTIVE" | "NO_SHOW" | "DEPARTED";
  source: "ONBOARDING" | "TICKET" | "MANUAL";
  role: Role | null;
  building: Building | null;
  startDate: string | null;
}
interface MatchResult {
  kind: "match" | "suggest" | "create";
  staff?: Staff;
  similarity?: number;
  candidates?: Array<{ staff: Staff; similarity: number }>;
}
interface AdPrefixResult {
  suggestion: string;
  candidates: string[];
  collisions: string[];
}

export default function StaffPage() {
  return (
    <AppShell eyebrow="Directory" title="Staff">
      {() => (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
          <StaffListPanel />
          <NewStaffPanel />
        </div>
      )}
    </AppShell>
  );
}

function StaffListPanel() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [filterBuilding, setFilterBuilding] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<Building[]>("/buildings").then(setBuildings);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (filterBuilding) params.set("buildingId", filterBuilding);
    if (filterSource) params.set("source", filterSource);
    if (q) params.set("q", q);
    const qs = params.toString();
    setLoading(true);
    api<Staff[]>(`/staff${qs ? `?${qs}` : ""}`).then((rows) => {
      setStaff(rows);
      setLoading(false);
    });
  }, [filterBuilding, filterSource, q]);

  return (
    <SectionCard
      title="People"
      count={staff.length}
      actions={
        <>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              placeholder="Search…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="field-sm w-40 pl-7"
            />
          </div>
          <select
            value={filterBuilding}
            onChange={(e) => setFilterBuilding(e.target.value)}
            className="field-sm"
          >
            <option value="">All buildings</option>
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <select
            value={filterSource}
            onChange={(e) => setFilterSource(e.target.value)}
            className="field-sm"
          >
            <option value="">Any source</option>
            <option value="ONBOARDING">Onboarding</option>
            <option value="TICKET">Ticket</option>
            <option value="MANUAL">Manual</option>
          </select>
        </>
      }
    >
      {loading ? (
        <div className="px-5 py-10 text-center text-sm text-ink-soft">Loading…</div>
      ) : staff.length === 0 ? (
        <EmptyState title="No staff match these filters" hint="Try clearing the search or filters." />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              {["Name", "AD prefix", "Role", "Building", "Status", "Source"].map((h) => (
                <th key={h} className="px-5 py-2.5 font-mono text-[10px] font-medium uppercase tracking-wider text-ink-faint">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => {
              const emp = employmentBadge(s.employmentStatus);
              const src = sourceBadge(s.source);
              return (
                <tr key={s.id} className="border-b border-line/70 transition last:border-0 hover:bg-paper-deep/40">
                  <td className="px-5 py-3 font-medium">
                    <Link href={`/staff/${s.id}`} className="decoration-accent/40 underline-offset-2 hover:underline">
                      {s.fullName}
                    </Link>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-ink-soft">{s.adPrefix ?? "—"}</td>
                  <td className="px-5 py-3 text-ink-soft">{s.role?.title ?? "—"}</td>
                  <td className="px-5 py-3 text-ink-soft">{s.building?.name ?? "—"}</td>
                  <td className="px-5 py-3">
                    <Pill tone={emp.tone} dot>
                      {emp.label}
                    </Pill>
                  </td>
                  <td className="px-5 py-3">
                    <Pill tone={src.tone}>{src.label}</Pill>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </SectionCard>
  );
}

function NewStaffPanel() {
  const [fullName, setFullName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [adPrefix, setAdPrefix] = useState<AdPrefixResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Building[]>("/buildings").then(setBuildings);
    api<Role[]>("/roles").then(setRoles);
  }, []);

  useEffect(() => {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length >= 2 && !firstName && !lastName) {
      setFirstName(parts[0]!);
      setLastName(parts.slice(1).join(" "));
    }
  }, [fullName, firstName, lastName]);

  useEffect(() => {
    if (!fullName.trim()) {
      setMatch(null);
      return;
    }
    const handle = setTimeout(() => {
      api<MatchResult>("/staff/match", {
        method: "POST",
        body: { name: fullName, buildingId: buildingId || undefined },
      })
        .then(setMatch)
        .catch(() => setMatch(null));
    }, 250);
    return () => clearTimeout(handle);
  }, [fullName, buildingId]);

  useEffect(() => {
    if (!firstName.trim() || !lastName.trim()) {
      setAdPrefix(null);
      return;
    }
    const handle = setTimeout(() => {
      api<AdPrefixResult>("/staff/ad-prefix/suggest", {
        method: "POST",
        body: { firstName, lastName },
      })
        .then(setAdPrefix)
        .catch(() => setAdPrefix(null));
    }, 250);
    return () => clearTimeout(handle);
  }, [firstName, lastName]);

  const matchHint = useMemo(() => {
    if (!match) return null;
    if (match.kind === "match" && match.staff) {
      return (
        <div className="rounded-field border border-honey/30 bg-honey-wash p-2.5 text-xs text-honey">
          Likely match: <strong>{match.staff.fullName}</strong>
          {match.similarity ? ` (${Math.round(match.similarity * 100)}%)` : ""}. Confirm before
          creating a duplicate.
        </div>
      );
    }
    if (match.kind === "suggest" && match.candidates?.length) {
      return (
        <div className="rounded-field border border-slatey/25 bg-slatey-wash p-2.5 text-xs text-slatey">
          Possible duplicates:{" "}
          {match.candidates
            .map((c) => `${c.staff.fullName} (${Math.round(c.similarity * 100)}%)`)
            .join(", ")}
        </div>
      );
    }
    return null;
  }, [match]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api("/staff", {
        method: "POST",
        body: {
          fullName,
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          buildingId: buildingId || undefined,
          roleId: roleId || undefined,
          source: "MANUAL",
        },
      });
      setFullName("");
      setFirstName("");
      setLastName("");
      setRoleId("");
      setBuildingId("");
      setMatch(null);
      setAdPrefix(null);
      window.location.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel h-fit p-5">
      <h2 className="text-[15px] font-semibold text-ink">Add staff</h2>
      <p className="mt-1 text-xs text-ink-soft">Live duplicate detection and AD-prefix suggestion.</p>
      <form onSubmit={submit} className="mt-4 space-y-3.5 text-sm">
        <label className="block text-[13px] font-medium text-ink-soft">
          Full name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required className="field mt-1.5" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[13px] font-medium text-ink-soft">
            First
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className="field mt-1.5" />
          </label>
          <label className="block text-[13px] font-medium text-ink-soft">
            Last
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} className="field mt-1.5" />
          </label>
        </div>
        <label className="block text-[13px] font-medium text-ink-soft">
          Role
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)} className="field mt-1.5">
            <option value="">—</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[13px] font-medium text-ink-soft">
          Building
          <select value={buildingId} onChange={(e) => setBuildingId(e.target.value)} className="field mt-1.5">
            <option value="">—</option>
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>

        {adPrefix?.suggestion && (
          <div className="rounded-field border border-line bg-paper-deep/50 p-2.5 text-xs">
            <div className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
              Suggested AD prefix
            </div>
            <div className="mt-0.5 font-mono text-sm text-accent">{adPrefix.suggestion}</div>
            {adPrefix.collisions.length > 0 && (
              <div className="mt-1 text-ink-soft">Collisions handled: {adPrefix.collisions.join(", ")}</div>
            )}
          </div>
        )}
        {matchHint}
        {error && <ErrorNote>{error}</ErrorNote>}

        <button type="submit" disabled={busy || !fullName.trim()} className="btn-primary w-full">
          {busy ? "Saving…" : "Create staff"}
        </button>
      </form>
    </section>
  );
}
