import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "@/prisma/prisma.module.js";
import { AuthModule } from "@/auth/auth.module.js";
import { SessionAuthGuard } from "@/auth/session-auth.guard.js";
import { CsrfGuard } from "@/auth/csrf.guard.js";
import { AuthorizationModule } from "@/authorization/authorization.module.js";
import { ConnectionsModule } from "@/connections/connections.module.js";
import { BucketsModule } from "@/buckets/buckets.module.js";
import { FilesModule } from "@/files/files.module.js";
import { UsersModule } from "@/users/users.module.js";
import { SettingsModule } from "@/settings/settings.module.js";
import { AuditModule } from "@/audit/audit.module.js";
import { AppController } from "./app.controller.js";
import { loadEnv } from "@/common/env.js";
import { CryptoService } from "@/common/crypto.service.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: loadEnv
    }),
    PrismaModule,
    AuthModule,
    AuthorizationModule,
    ConnectionsModule,
    BucketsModule,
    FilesModule,
    UsersModule,
    SettingsModule,
    AuditModule
  ],
  controllers: [AppController],
  providers: [
    CryptoService,
    {
      provide: APP_GUARD,
      useClass: SessionAuthGuard
    },
    {
      provide: APP_GUARD,
      useClass: CsrfGuard
    }
  ]
})
export class AppModule {}
