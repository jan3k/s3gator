import { Module } from "@nestjs/common";
import { BucketsService } from "./buckets.service.js";
import { BucketsController } from "./buckets.controller.js";

@Module({
  providers: [BucketsService],
  controllers: [BucketsController],
  exports: [BucketsService]
})
export class BucketsModule {}
