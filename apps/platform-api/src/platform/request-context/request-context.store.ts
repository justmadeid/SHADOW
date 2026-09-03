import { AsyncLocalStorage } from "node:async_hooks";
import type { AuthenticatedPrincipal } from "@intelligence/auth";
import { Injectable } from "@nestjs/common";
import type { RequestContext } from "./request-context.js";

@Injectable()
export class RequestContextStore {
  private readonly storage = new AsyncLocalStorage<RequestContext>();

  run<T>(context: RequestContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  get(): RequestContext {
    const context = this.storage.getStore();
    if (!context) {
      throw new Error("RequestContext is not available in the current async scope.");
    }
    return context;
  }

  getOptional(): RequestContext | undefined {
    return this.storage.getStore();
  }

  setPrincipal(principal: AuthenticatedPrincipal): void {
    const context = this.get();
    context.principal = principal;

    delete context.userId;
    delete context.serviceId;

    if (principal.kind === "USER") {
      context.userId = principal.userId;
    } else {
      context.serviceId = principal.serviceId;
    }
  }
}
