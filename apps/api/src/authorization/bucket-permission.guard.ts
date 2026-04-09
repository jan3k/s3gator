import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthorizationService } from "./authorization.service.js";
import { REQUIRED_BUCKET_PERMISSION, type BucketPermissionRequirement } from "./permission.decorator.js";
import type { AuthenticatedRequest } from "@/common/request-context.js";

@Injectable()
export class BucketPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorizationService: AuthorizationService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<BucketPermissionRequirement>(REQUIRED_BUCKET_PERMISSION, [
      context.getHandler(),
      context.getClass()
    ]);

    if (!requirement) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const source = requirement.source ?? "query";
    const field = requirement.bucketField ?? "bucket";

    const bucketName = String((request[source] as Record<string, unknown> | undefined)?.[field] ?? "");
    await this.authorizationService.requireBucketPermission(request.user, bucketName || undefined, requirement.permission);
    return true;
  }
}
