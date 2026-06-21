import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../auth/types";
import { DevicesService } from "../devices/devices.service";
import { LlmService } from "../llm/llm.service";
import { PiiService } from "../llm/pii.service";
import { OffboardingService } from "../offboarding/offboarding.service";
import { PrismaService } from "../prisma/prisma.service";
import { StaffService } from "../staff/staff.service";
import { TasksService } from "../tasks/tasks.service";
import { ChatDto } from "./dto";
import { READ_TOOLS, WRITE_TOOLS, toolCatalog } from "./tools";

const MAX_STEPS = 6;

interface StepLog {
  tool: string;
  args: Record<string, unknown>;
}

export type AssistantResult =
  | { type: "message"; text: string; steps: StepLog[] }
  | { type: "proposal"; tool: string; args: Record<string, unknown>; summary: string; steps: StepLog[] };

interface Plan {
  reply?: string | null;
  tool?: { name: string; args?: Record<string, unknown> } | null;
  confirm?: boolean;
}

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly pii: PiiService,
    private readonly audit: AuditService,
    private readonly tasks: TasksService,
    private readonly devices: DevicesService,
    private readonly staff: StaffService,
    private readonly offboarding: OffboardingService,
  ) {}

  // ---- chat (agent loop) --------------------------------------------

  async chat(dto: ChatDto, actor: AuthenticatedUser): Promise<AssistantResult> {
    if (this.llm.providerName === "stub") {
      return {
        type: "message",
        steps: [],
        text:
          "I'm wired up and ready, but I need an LLM key to think. Set OPENAI_API_KEY or " +
          "ANTHROPIC_API_KEY on the API and I can search records, create tasks, assign/return " +
          "devices and start offboardings on command — every write asks you to confirm first.",
      };
    }

    const names = (await this.prisma.staff.findMany({ select: { fullName: true } })).map((s) => s.fullName);
    const masker = new NameMasker(names, this.pii.isEnabled);

    const convo: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: this.systemPrompt() },
    ];
    for (const m of dto.messages) {
      convo.push({ role: m.role, content: masker.mask(m.content) });
    }

    const steps: StepLog[] = [];

    for (let i = 0; i < MAX_STEPS; i++) {
      const { text } = await this.llm.complete({ messages: convo, temperature: 0, maxTokens: 800 });
      const plan = parsePlan(text);

      if (!plan.tool?.name) {
        return { type: "message", text: masker.unmask(plan.reply ?? "Done."), steps };
      }

      const name = plan.tool.name;
      const args = masker.unmaskArgs(plan.tool.args ?? {});

      // Writes are never auto-run — hand back a proposal for the user to confirm.
      if (WRITE_TOOLS.has(name) || plan.confirm) {
        return {
          type: "proposal",
          tool: name,
          args,
          summary: masker.unmask(plan.reply ?? `Run ${name}?`),
          steps,
        };
      }

      if (!READ_TOOLS.has(name)) {
        convo.push({ role: "assistant", content: text });
        convo.push({ role: "user", content: `TOOL_RESULT(${name}): unknown tool` });
        continue;
      }

      // Read tool — execute and feed the result back into the loop.
      let result: unknown;
      try {
        result = await this.executeTool(name, args, actor);
      } catch (err) {
        result = { error: (err as Error).message };
      }
      steps.push({ tool: name, args });
      convo.push({ role: "assistant", content: text });
      convo.push({
        role: "user",
        content: `TOOL_RESULT(${name}): ${masker.mask(JSON.stringify(result).slice(0, 4000))}`,
      });
    }

    return {
      type: "message",
      text: "I couldn't finish that in a few steps — try rephrasing or breaking it into smaller commands.",
      steps,
    };
  }

  // ---- act (execute a confirmed write) ------------------------------

  async act(tool: string, args: Record<string, unknown>, actor: AuthenticatedUser) {
    if (!WRITE_TOOLS.has(tool)) {
      throw new BadRequestException(`'${tool}' is not a confirmable action`);
    }
    const result = await this.executeTool(tool, args, actor);
    await this.audit.record({
      action: "assistant.act",
      userId: actor.userId,
      entityType: "Assistant",
      metadata: { tool, args },
    });
    return { ok: true, tool, result };
  }

  // ---- tool execution (everything routes through existing services) -

  private async executeTool(name: string, a: Record<string, unknown>, actor: AuthenticatedUser): Promise<unknown> {
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);

    switch (name) {
      case "search_staff": {
        const rows = await this.staff.list({ q: str(a.query) });
        return (rows as Array<Record<string, unknown>>).slice(0, 10).map((s) => ({
          id: s.id,
          fullName: s.fullName,
          role: (s.role as { title?: string } | null)?.title ?? null,
          building: (s.building as { name?: string } | null)?.name ?? null,
          employmentStatus: s.employmentStatus,
        }));
      }
      case "search_devices": {
        const rows = await this.devices.list({
          q: str(a.query),
          status: str(a.status) as never,
          type: str(a.type) as never,
        });
        return (rows as Array<Record<string, unknown>>).slice(0, 15).map((d) => ({
          id: d.id,
          type: d.type,
          model: d.model,
          assetTag: d.assetTag,
          status: d.status,
        }));
      }
      case "list_tasks":
        return (await this.tasks.list({ status: str(a.status) as never, q: str(a.query) })).slice(0, 20);
      case "summary": {
        const [staffCount, inStock, taskStats, onboardings] = await Promise.all([
          this.prisma.staff.count(),
          this.prisma.device.count({ where: { status: "IN_STOCK" } }),
          this.tasks.stats(),
          this.prisma.onboarding.count(),
        ]);
        return { staff: staffCount, devicesInStock: inStock, openTasks: taskStats.open, overdueTasks: taskStats.overdue, onboardings };
      }
      case "create_task":
        return this.tasks.create(
          {
            title: String(a.title ?? "Untitled task"),
            type: str(a.type) as never,
            priority: str(a.priority) as never,
            dueDate: str(a.dueDate),
            staffId: str(a.staffId),
            buildingId: str(a.buildingId),
            deviceId: str(a.deviceId),
            source: "ASSISTANT",
          },
          actor,
        );
      case "update_task":
        if (!str(a.id)) throw new BadRequestException("update_task requires id");
        return this.tasks.update(
          String(a.id),
          { status: str(a.status) as never, priority: str(a.priority) as never, title: str(a.title) },
          actor,
        );
      case "assign_device":
        if (!str(a.deviceId) || !str(a.staffId)) throw new BadRequestException("assign_device requires deviceId and staffId");
        return this.devices.assign(String(a.deviceId), { staffId: String(a.staffId), notes: str(a.notes) }, actor);
      case "return_device":
        if (!str(a.deviceId)) throw new BadRequestException("return_device requires deviceId");
        return this.devices.return(String(a.deviceId), { notes: str(a.notes) }, actor);
      case "start_offboarding":
        if (!str(a.staffId)) throw new BadRequestException("start_offboarding requires staffId");
        return this.offboarding.start({ staffId: String(a.staffId), lastDay: str(a.lastDay), reason: str(a.reason) }, actor);
      default:
        throw new BadRequestException(`Unknown tool: ${name}`);
    }
  }

  private systemPrompt(): string {
    const today = new Date().toISOString().slice(0, 10);
    return [
      "You are the TRICON IT HUB assistant — an agent for an IT support team managing staff, devices, onboarding and tasks.",
      `Today is ${today}.`,
      "",
      "You act by calling tools. Available tools:",
      toolCatalog(),
      "",
      "PROTOCOL — respond with ONLY a single JSON object, no prose outside it:",
      `{ "reply": string|null, "tool": { "name": string, "args": object } | null, "confirm": boolean }`,
      "- To gather information, call a READ tool (confirm=false). Its result is fed back to you, then continue.",
      "- To change data, propose a WRITE tool with confirm=true and put a one-line plain-English description in `reply`. NEVER assume a write succeeded — it only runs after the user confirms.",
      "- When you have the answer or have proposed the action, set tool=null and put your message in `reply`.",
      "- Always resolve people/devices to ids via search tools BEFORE proposing a write that needs an id.",
      "- People may appear as [[PERSON_n]] tokens — treat them as opaque names and pass them through unchanged.",
      "- Be concise. Prefer one clear action over many.",
    ].join("\n");
  }
}

// ---- helpers ---------------------------------------------------------

function parsePlan(text: string): Plan {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return { reply: text.trim() || "…", tool: null };
  try {
    return JSON.parse(text.slice(start, end + 1)) as Plan;
  } catch {
    return { reply: text.trim(), tool: null };
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Stable, multi-turn PII masker: assigns each known staff name a [[PERSON_n]]
 * token the first time it's seen and reuses it for the rest of the conversation,
 * so a token means the same person across every turn (the per-call PiiService
 * can't guarantee that). Pass-through when PII_PSEUDONYMIZE is off.
 */
class NameMasker {
  private readonly names: string[];
  private readonly nameToToken = new Map<string, string>();
  private readonly tokenToName = new Map<string, string>();
  private counter = 0;

  constructor(names: string[], private readonly enabled: boolean) {
    this.names = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 2))].sort(
      (a, b) => b.length - a.length,
    );
  }

  mask(text: string): string {
    if (!this.enabled || !text) return text;
    let out = text;
    for (const name of this.names) {
      const re = new RegExp(escapeRegExp(name), "gi");
      if (re.test(out)) {
        let token = this.nameToToken.get(name);
        if (!token) {
          token = `[[PERSON_${++this.counter}]]`;
          this.nameToToken.set(name, token);
          this.tokenToName.set(token, name);
        }
        out = out.replace(re, token);
      }
    }
    return out;
  }

  unmask(text: string): string {
    if (!text) return text;
    let out = text;
    for (const [token, name] of this.tokenToName) out = out.split(token).join(name);
    return out;
  }

  unmaskArgs(args: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) out[k] = typeof v === "string" ? this.unmask(v) : v;
    return out;
  }
}
