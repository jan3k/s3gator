import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "@/app.module.js";
import { JobRetentionService } from "@/jobs/job-retention.service.js";

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true
  });

  try {
    const retention = app.get(JobRetentionService);
    const summary = await retention.runCleanup();
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    await app.close();
  }
}

void main();
