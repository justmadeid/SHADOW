import { Controller, Get } from "@nestjs/common";

import { RequestContextStore } from "../../platform/request-context/index.js";

@Controller("api/v1/system")
export class SystemController {
  constructor(private readonly requestContext: RequestContextStore) {}

  @Get("info")
  info() {
    const context = this.requestContext.get();

    return {
      service: "platform-api",
      status: "ok",
      requestId: context.requestId,
      traceId: context.traceId,
      version: process.env.APP_VERSION ?? "0.0.0-dev",
    };
  }
}
