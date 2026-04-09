import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AppRole } from "@s3gator/shared";
import { AuthorizationService } from "./authorization.service.js";
import { REQUIRED_ROLES } from "./role.decorator.js";
import type { AuthenticatedRequest } from "@/common/request-context.js";

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorizationService: AuthorizationService
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<AppRole[]>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass()
    ]);

    if (!roles?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    this.authorizationService.requireRole(request.user, roles);
    return true;
  }
}
