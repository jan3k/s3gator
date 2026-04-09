import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { JobsWorkerService } from "@/jobs/jobs.worker.service.js";
import { initTelemetry, shutdownTelemetry } from "@/telemetry/otel.js";

async function bootstrapWorker() {
  await initTelemetry({
    enabled: readBooleanEnv(process.env.OTEL_ENABLED, false),
    serviceName: process.env.OTEL_SERVICE_NAME ?? "s3gator-worker",
    otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    otlpHeaders: process.env.OTEL_EXPORTER_OTLP_HEADERS
  });

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
    await shutdownTelemetry();
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

function readBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return value === "true" || value === "1";
}
