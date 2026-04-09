import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { AppModule } from "./app.module.js";

const createPinoHttp = pinoHttp as unknown as (options: Record<string, unknown>) => (req: unknown, res: unknown, next: () => void) => void;

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true
  });

  const config = app.get(ConfigService);

  app.use(
    createPinoHttp({
      level: config.get<string>("NODE_ENV") === "production" ? "info" : "debug",
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "res.headers['set-cookie']",
          "req.body.password",
          "req.body.secretAccessKey",
          "req.body.accessKeyId",
          "req.body.adminToken"
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
}

bootstrap().catch((error) => {
  Logger.error(error, undefined, "Bootstrap");
  process.exitCode = 1;
});
