import { Global, MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { LoggingModule } from "../observability/logging/logger.module.js";
import { RequestContextMiddleware } from "./request-context.middleware.js";
import { RequestContextStore } from "./request-context.store.js";

@Global()
@Module({
  imports: [LoggingModule],
  providers: [RequestContextStore, RequestContextMiddleware],
  exports: [RequestContextStore],
})
export class RequestContextModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes("*");
  }
}
