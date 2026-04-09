import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { randomUUID } from "node:crypto";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import type { NextFunction, Response } from "express";
import { runWithRequestContext, type AuthenticatedRequest } from "@/common/request-context.js";
import { initTelemetry, shutdownTelemetry } from "@/telemetry/otel.js";
import { AppModule } from "./app.module.js";

const createPinoHttp = pinoHttp as unknown as (options: Record<string, unknown>) => (req: unknown, res: unknown, next: () => void) => void;

async function bootstrap() {
  await initTelemetry({
    enabled: readBooleanEnv(process.env.OTEL_ENABLED, false),
    serviceName: process.env.OTEL_SERVICE_NAME ?? "s3gator-api",
    otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    otlpHeaders: process.env.OTEL_EXPORTER_OTLP_HEADERS
  });

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true
  });

  const config = app.get(ConfigService);
  const correlationHeaderName = config.get<string>("CORRELATION_HEADER_NAME", "x-request-id");
  const normalizedHeaderName = correlationHeaderName.toLowerCase();

  app.use((req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const request = req;
    const incoming = request.headers[normalizedHeaderName];
    const requestId =
      (Array.isArray(incoming) ? incoming[0] : incoming)?.toString().trim() || randomUUID();

    request.requestId = requestId;
    request.correlationId = requestId;
    res.setHeader(correlationHeaderName, requestId);

    runWithRequestContext(
      {
        requestId,
        correlationId: requestId,
        source: "http"
      },
      () => next()
    );
  });

  app.use(
    createPinoHttp({
      level: config.get<string>("NODE_ENV") === "production" ? "info" : "debug",
      genReqId: (req: AuthenticatedRequest) => req.requestId ?? randomUUID(),
      customProps: (req: AuthenticatedRequest) => ({
        correlationId: req.correlationId ?? null
      }),
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.headers.x-csrf-token",
          "res.headers['set-cookie']",
          "req.body.password",
          "req.body.secretAccessKey",
          "req.body.accessKeyId",
          "req.body.adminToken",
          "req.body.bindPassword"
        ],
        remove: true
      }
    })
  );

  app.use(cookieParser());
  app.enableCors({
    origin: true,
    credentials: true
  });

  const swagger = new DocumentBuilder()
    .setTitle("S3Gator API")
    .setDescription("Garage S3 Manager backend API")
    .setVersion("0.1.0")
    .addCookieAuth(config.get<string>("SESSION_COOKIE_NAME", "s3gator_sid"))
    .build();

  const document = SwaggerModule.createDocument(app, swagger);
  SwaggerModule.setup("docs", app, document);

  const port = config.get<number>("PORT", 4000);
  await app.listen(port);

  Logger.log(`API listening on http://localhost:${port}`, "Bootstrap");

  const shutdown = async () => {
    await app.close();
    await shutdownTelemetry();
  };

  process.on("SIGINT", () => {
    void shutdown();
  });

  process.on("SIGTERM", () => {
    void shutdown();
  });
}

bootstrap().catch((error) => {
  Logger.error(error, undefined, "Bootstrap");
  void shutdownTelemetry();
  process.exitCode = 1;
});

function readBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return value === "true" || value === "1";
}
