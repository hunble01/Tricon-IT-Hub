/**
 * Identity source contract. CRM Staff records can later be fed by AD/Entra sync
 * in addition to the manual/onboarding/ticket sources of Phase 1. The Staff table
 * is the single store; this interface is the upsert seam for future syncs.
 * (Phase 1 seam only — do not implement an AD/Entra sync now.)
 */

export type StaffSource = "ONBOARDING" | "TICKET" | "MANUAL" | "AD_SYNC" | "ENTRA_SYNC";

export interface IdentityRecord {
  externalId?: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  adPrefix?: string;
  roleTitle?: string;
  buildingName?: string;
  startDate?: Date;
  source: StaffSource;
}

export interface IdentitySource {
  readonly name: string;
  /** Yields identity records to upsert into Staff. */
  pull(): AsyncIterable<IdentityRecord>;
}
