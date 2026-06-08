import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue, Worker } from "bullmq";
import { SlaService } from "./sla.service";

const QUEUE_NAME = "sla";
const SCHEDULER_ID = "sla-sweep";
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

interface RedisConnectionOpts {
  host: string;
  port: number;
  username?: string;
  password?: string;
  maxRetriesPerRequest: null;
}

/**
 * Phase 2 — first real BullMQ use. Registers a repeatable "SLA sweep" job that
 * periodically re-checks open tickets against their SLA and records the result.
 * This is the reminder engine; a later phase hangs a digest email off it.
 *
 * Built to be non-fatal: if Redis is unreachable the API still boots — the
 * sweep simply doesn't run, and an error is logged. Disable with SLA_JOBS=false.
 */
@Injectable()
export class SlaScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SlaScheduler.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly config: ConfigService,
    private readonly sla: SlaService,
  ) {}

  private connection(): RedisConnectionOpts | null {
    const url = this.config.get<string>("REDIS_URL");
    if (!url) return null;
    try {
      const u = new URL(url);
      return {
        host: u.hostname || "localhost",
        port: Number(u.port) || 6379,
        username: u.username || undefined,
        password: u.password || undefined,
        maxRetriesPerRequest: null, // required by BullMQ workers
      };
    } catch {
      return null;
    }
  }

  async onModuleInit(): Promise<void> {
    if (this.config.get<string>("SLA_JOBS") === "false") {
      this.logger.log("SLA jobs disabled (SLA_JOBS=false)");
      return;
    }
    const connection = this.connection();
    if (!connection) {
      this.logger.warn("No REDIS_URL — SLA sweep job not scheduled");
      return;
    }

    const intervalMs = Number(this.config.get<string>("SLA_SWEEP_MS")) || DEFAULT_INTERVAL_MS;

    try {
      this.queue = new Queue(QUEUE_NAME, { connection });
      this.queue.on("error", (err) => this.logger.error(`SLA queue error: ${err.message}`));

      this.worker = new Worker(
        QUEUE_NAME,
        async () => {
          const scan = await this.sla.sweep();
          return scan.counts;
        },
        { connection },
      );
      this.worker.on("error", (err) => this.logger.error(`SLA worker error: ${err.message}`));
      this.worker.on("failed", (_job, err) => this.logger.error(`SLA sweep failed: ${err?.message}`));

      // Idempotent: re-registering the scheduler just updates the interval.
      await this.queue.upsertJobScheduler(SCHEDULER_ID, { every: intervalMs }, { name: "sweep" });
      this.logger.log(`SLA sweep scheduled every ${Math.round(intervalMs / 60000)} min`);
    } catch (err) {
      this.logger.error(`Failed to start SLA scheduler: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }
}
