import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { PLATFORM_DB_POOL } from "../database/database.module.js";

@Injectable()
export class HealthService {
  constructor(@Inject(PLATFORM_DB_POOL) private readonly pool: Pool) {}

  liveness() {
    return {
      status: "ok",
      service: "platform-api",
    };
  }

  async readiness() {
    await this.pool.query("select 1");

    return {
      status: "ready",
      checks: {
        postgres: "up",
      },
    };
  }
}
