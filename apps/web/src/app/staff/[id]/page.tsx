"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Pill, SectionCard, employmentBadge, sourceBadge, ticketBadge } from "@/components/ui";
import { api } from "@/lib/api";

interface StaffDetail {
  id: string;
  fullName: string;
  firstName: string;
  lastName: string;
  adPrefix: string | null;
  source: "ONBOARDING" | "TICKET" | "MANUAL";
  employmentStatus: string;
  email: string | null;
  phone: string | null;
  startDate: string | null;
  notes: string | null;
  role: { title: string; deviceProfile?: Array<{ deviceType: string; quantity: number }> } | null;
  building: { name: string } | null;
  onboarding: {
    monthLabel: string | null;
    deviceStatus: string;
    adDone: boolean;
    badgeDone: boolean;
    hardwareDone: boolean;
    softwareDone: boolean;
  } | null;
  devices: Array<{
    id: string;
    assignedAt: string;
    returnedAt: string | null;
    device: { id: string; type: string; assetTag: string | null; model: string | null };
  }>;
  tickets: Array<{ id: string; subject: string; status: string; createdAt: string }>;
}

export default function StaffDetailPage() {
  const params = useParams<{ id: string }>();
  const [staff, setStaff] = useState<StaffDetail | null>(null);

  useEffect(() => {
    if (!params.id) return;
    api<StaffDetail>(`/staff/${params.id}`).then(setStaff);
  }, [params.id]);

  return (
    <AppShell eyebrow="Directory · Profile" title={staff?.fullName ?? "Staff"}>
      {() =>
        !staff ? (
          <div className="panel px-5 py-12 text-center text-sm text-ink-soft">Loading…</div>
        ) : (
          <Detail staff={staff} />
        )
      }
    </AppShell>
  );
}

function Detail({ staff }: { staff: StaffDetail }) {
  const emp = employmentBadge(staff.employmentStatus);
  const src = sourceBadge(staff.source);

  return (
    <div className="space-y-5">
      <Link href="/staff" className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-soft transition hover:text-ink">
        <ArrowLeft size={14} /> Back to staff
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-sm text-ink-soft">{staff.role?.title ?? "—"}</span>
        <span className="text-line-strong">·</span>
        <span className="text-sm text-ink-soft">{staff.building?.name ?? "—"}</span>
        <span className="text-line-strong">·</span>
        <span className="font-mono text-sm text-accent">{staff.adPrefix ?? "—"}</span>
        <Pill tone={emp.tone} dot>{emp.label}</Pill>
        <Pill tone={src.tone}>{src.label}</Pill>
      </div>

      <SectionCard title="Details" bodyClassName="px-5 py-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <Field label="Source" value={src.label} />
          <Field label="Employment" value={emp.label} />
          <Field label="Email" value={staff.email ?? "—"} />
          <Field label="Phone" value={staff.phone ?? "—"} />
          <Field
            label="Start date"
            value={staff.startDate ? new Date(staff.startDate).toLocaleDateString() : "—"}
          />
        </dl>
        {staff.notes && (
          <p className="mt-4 whitespace-pre-wrap border-t border-line pt-4 text-sm text-ink-soft">
            {staff.notes}
          </p>
        )}
      </SectionCard>

      <KitSection staff={staff} />

      {staff.onboarding && (
        <SectionCard title="Onboarding" bodyClassName="px-5 py-4">
          <p className="text-xs text-ink-soft">
            {staff.onboarding.monthLabel ?? "—"} · devices {staff.onboarding.deviceStatus.toLowerCase().replace(/_/g, " ")}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <CheckRow label="AD account" done={staff.onboarding.adDone} />
            <CheckRow label="Badge" done={staff.onboarding.badgeDone} />
            <CheckRow label="Hardware" done={staff.onboarding.hardwareDone} />
            <CheckRow label="Software" done={staff.onboarding.softwareDone} />
          </div>
        </SectionCard>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SectionCard title="Devices" count={staff.devices.length}>
          {staff.devices.length === 0 ? (
            <p className="px-5 py-6 text-xs text-ink-soft">No devices assigned.</p>
          ) : (
            <ul className="divide-y divide-line">
              {staff.devices.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 px-5 py-3 text-sm">
                  <span className="text-ink">
                    <Link href={`/devices/${a.device.id}`} className="decoration-accent/40 underline-offset-2 hover:underline">
                      {a.device.type}
                    </Link>{" "}
                    <span className="text-ink-soft">{a.device.model ?? ""}</span>{" "}
                    {a.device.assetTag && <span className="font-mono text-xs text-ink-faint">#{a.device.assetTag}</span>}
                  </span>
                  <span className="text-xs text-ink-faint">
                    {new Date(a.assignedAt).toLocaleDateString()}
                    {a.returnedAt && ` → returned`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Tickets" count={staff.tickets.length}>
          {staff.tickets.length === 0 ? (
            <p className="px-5 py-6 text-xs text-ink-soft">No tickets.</p>
          ) : (
            <ul className="divide-y divide-line">
              {staff.tickets.map((t) => {
                const badge = ticketBadge(t.status);
                return (
                  <li key={t.id} className="flex items-center justify-between gap-2 px-5 py-3 text-sm">
                    <span className="truncate text-ink">{t.subject}</span>
                    <div className="flex shrink-0 items-center gap-2">
                      <Pill tone={badge.tone}>{badge.label}</Pill>
                      <span className="text-xs text-ink-faint">{new Date(t.createdAt).toLocaleDateString()}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function KitSection({ staff }: { staff: StaffDetail }) {
  const expected = staff.role?.deviceProfile ?? [];
  const held: Record<string, number> = {};
  for (const a of staff.devices) {
    if (!a.returnedAt) held[a.device.type] = (held[a.device.type] ?? 0) + 1;
  }
  const expectedTypes = new Set(expected.map((e) => e.deviceType));
  const extras = Object.entries(held).filter(([t]) => !expectedTypes.has(t));
  const allComplete = expected.length > 0 && expected.every((e) => (held[e.deviceType] ?? 0) >= e.quantity);

  if (expected.length === 0 && Object.keys(held).length === 0) return null;

  return (
    <SectionCard
      title="Kit"
      actions={
        expected.length > 0 ? (
          <Pill tone={allComplete ? "success" : "warn"} dot>
            {allComplete ? "Complete" : "Incomplete"}
          </Pill>
        ) : undefined
      }
      bodyClassName="px-5 py-4"
    >
      {expected.length > 0 ? (
        <div className="space-y-1.5">
          {expected.map((e) => {
            const have = held[e.deviceType] ?? 0;
            const ok = have >= e.quantity;
            return (
              <div key={e.deviceType} className="flex items-center justify-between rounded-field border border-line px-3 py-2 text-sm">
                <span className="text-ink">{e.deviceType.toLowerCase().replace(/_/g, " ")}</span>
                <span className="flex items-center gap-2">
                  <span className={`font-mono text-xs ${ok ? "text-accent" : "text-clay"}`}>
                    {have}/{e.quantity}
                  </span>
                  {ok ? <Pill tone="success">ok</Pill> : <Pill tone="danger">missing {e.quantity - have}</Pill>}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-ink-soft">No standard kit defined for this role.</p>
      )}
      {extras.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-faint">Also holding</div>
          <div className="flex flex-wrap gap-1.5">
            {extras.map(([t, n]) => (
              <span key={t} className="rounded-full bg-paper-deep px-2 py-0.5 text-[11px] text-ink-soft">
                {n}× {t.toLowerCase().replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">{label}</dt>
      <dd className="mt-0.5 text-ink">{value}</dd>
    </div>
  );
}

function CheckRow({ label, done }: { label: string; done: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-field border px-3 py-2 text-xs ${
        done ? "border-accent/20 bg-accent-wash text-accent-ink" : "border-line text-ink-soft"
      }`}
    >
      <span
        className={`flex h-4 w-4 items-center justify-center rounded-[4px] border ${
          done ? "border-accent bg-accent text-white" : "border-line-strong"
        }`}
      >
        {done && <Check size={11} strokeWidth={3} />}
      </span>
      {label}
    </div>
  );
}
