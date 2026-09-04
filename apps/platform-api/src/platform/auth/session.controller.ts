import { Controller, Get, Inject, Res } from "@nestjs/common";
import type { Response } from "express";
import { RequestContextStore } from "../request-context/index.js";
import { AppError } from "../errors/index.js";

@Controller("api/v1/session")
export class SessionController {
  constructor(
    @Inject(RequestContextStore) private readonly context: RequestContextStore,
  ) {}

  @Get()
  get(@Res({ passthrough: true }) response: Response) {
    response.setHeader("cache-control", "private, no-store");
    const principal = this.context.get().principal;
    if (principal?.kind !== "USER")
      throw new AppError({
        code: "AUTH_USER_REQUIRED",
        message: "A user session is required.",
        statusCode: 403,
      });
    return { user: { id: principal.userId } };
  }
}
