import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "@/app.module.js";
import { MaintenanceSchedulerService } from "@/jobs/maintenance-scheduler.service.js";

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true
  });

  try {
    const scheduler = app.get(MaintenanceSchedulerService);
    await scheduler.runOnce();
    const status = await scheduler.getStatus();
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  } finally {
    await app.close();
  }
}

void main();
