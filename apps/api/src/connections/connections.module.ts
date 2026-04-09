import { Module } from "@nestjs/common";
import { ConnectionsService } from "./connections.service.js";
import { ConnectionsController } from "./connections.controller.js";

@Module({
  providers: [ConnectionsService],
  controllers: [ConnectionsController],
  exports: [ConnectionsService]
})
export class ConnectionsModule {}
