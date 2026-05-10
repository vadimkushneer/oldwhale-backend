import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { UserRole } from '../database/entities';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RequestWithUser } from './request-with-user';

@Injectable()
export class AdminGuard extends JwtAuthGuard {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    await super.canActivate(context);
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (request.user?.role !== UserRole.Admin) {
      throw new ForbiddenException('admin role required');
    }
    return true;
  }
}
