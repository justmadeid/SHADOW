import { Global, Module } from "@nestjs/common";
import { createPlatformLogger } from "./logger.js";

export const PLATFORM_LOGGER = Symbol("PLATFORM_LOGGER");

@Global()
@Module({
  providers: [
    {
      provide: PLATFORM_LOGGER,
      useFactory: () => createPlatformLogger(),
    },
  ],
  exports: [PLATFORM_LOGGER],
})
export class LoggingModule {}
