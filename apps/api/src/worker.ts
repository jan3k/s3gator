import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { JobsWorkerService } from "@/jobs/jobs.worker.service.js";

async function bootstrapWorker() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true
  });

  const worker = app.get(JobsWorkerService);
  worker.start();

  Logger.log("Jobs worker started", "WorkerBootstrap");

  const shutdown = async () => {
    Logger.log("Shutting down jobs worker", "WorkerBootstrap");
    worker.stop();
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });

  process.on("SIGTERM", () => {
    void shutdown();
  });
}

void bootstrapWorker();
