import { Module } from "@nestjs/common";
import { EntityModule } from "../entity/index.js";
import { SubjectModule } from "../subject/index.js";
import { TargetProfileFacade } from "./application/target-profile.facade.js";
import { TargetProfileController } from "./presentation/http/target-profile.controller.js";

@Module({
  imports: [SubjectModule, EntityModule],
  controllers: [TargetProfileController],
  providers: [TargetProfileFacade],
  exports: [TargetProfileFacade],
})
export class TargetProfileModule {}
