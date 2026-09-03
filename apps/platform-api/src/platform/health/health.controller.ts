import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";

import { PublicEndpoint } from "../auth/index.js";
import { HealthService } from "./health.service.js";

@PublicEndpoint()
@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get("live")
  live() {
    return this.health.liveness();
  }

  @Get("ready")
  async ready() {
    try {
      return await this.health.readiness();
    } catch {
      throw new ServiceUnavailableException({
        error: {
          code: "SERVICE_NOT_READY",
          message: "A critical dependency is unavailable.",
        },
      });
    }
  }
}
