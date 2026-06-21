/**
 * Tool catalog for the AI command box. Each tool maps to an EXISTING service
 * method, so every action the assistant takes flows through the same audited,
 * permission-checked service layer as the rest of the app.
 *
 * Tools are split read vs. write. Read tools run automatically inside the agent
 * loop; write tools are never auto-run — the loop returns them as a *proposal*
 * the user confirms in the UI, which then calls POST /assistant/act.
 */

export type ToolKind = "read" | "write";

export interface ToolDef {
  name: string;
  kind: ToolKind;
  description: string;
  /** Human-readable arg spec, inlined into the planner system prompt. */
  args: string;
}

export const TOOLS: ToolDef[] = [
  // ---- reads ----
  {
    name: "search_staff",
    kind: "read",
    description: "Find staff members by name, building, or role. Use to resolve a person before acting on them.",
    args: `{ "query": string }`,
  },
  {
    name: "search_devices",
    kind: "read",
    description: "Find devices in inventory. Filter by free-text query, status (IN_STOCK/ASSIGNED/...), or type (LAPTOP/MONITOR/...).",
    args: `{ "query"?: string, "status"?: string, "type"?: string }`,
  },
  {
    name: "list_tasks",
    kind: "read",
    description: "List tasks on the todo board. Filter by status (TODO/IN_PROGRESS/BLOCKED/DONE) or free-text query.",
    args: `{ "status"?: string, "query"?: string }`,
  },
  {
    name: "summary",
    kind: "read",
    description: "Get a quick operational summary: counts of staff, devices in stock, open tasks, active onboardings.",
    args: `{}`,
  },
  {
    name: "recall_history",
    kind: "read",
    description: "Search past tickets, resolutions and KB articles for how similar issues were handled before. Use for 'what did we do last time…' / 'how do we usually fix…' questions.",
    args: `{ "query": string }`,
  },
  // ---- writes (require confirmation) ----
  {
    name: "create_task",
    kind: "write",
    description: "Add a task to the todo board (non-ticket work like installs, setups, returns).",
    args: `{ "title": string, "type"?: string, "priority"?: string, "dueDate"?: "YYYY-MM-DD", "staffId"?: string, "buildingId"?: string, "deviceId"?: string }`,
  },
  {
    name: "update_task",
    kind: "write",
    description: "Update a task — most often to set its status (e.g. mark DONE).",
    args: `{ "id": string, "status"?: string, "priority"?: string, "title"?: string }`,
  },
  {
    name: "assign_device",
    kind: "write",
    description: "Assign an in-stock device to a staff member (opens a custody record).",
    args: `{ "deviceId": string, "staffId": string, "notes"?: string }`,
  },
  {
    name: "return_device",
    kind: "write",
    description: "Return an assigned device back to stock (closes its custody record).",
    args: `{ "deviceId": string, "notes"?: string }`,
  },
  {
    name: "start_offboarding",
    kind: "write",
    description: "Begin offboarding for an existing staff member (seeds the collect-devices and revoke-access tasks).",
    args: `{ "staffId": string, "lastDay"?: "YYYY-MM-DD", "reason"?: string }`,
  },
];

export const READ_TOOLS = new Set(TOOLS.filter((t) => t.kind === "read").map((t) => t.name));
export const WRITE_TOOLS = new Set(TOOLS.filter((t) => t.kind === "write").map((t) => t.name));

/** Render the catalog for the planner system prompt. */
export function toolCatalog(): string {
  return TOOLS.map(
    (t) => `- ${t.name} (${t.kind}): ${t.description} args: ${t.args}`,
  ).join("\n");
}
