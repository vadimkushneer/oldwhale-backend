import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { PublicUser } from '../users/users.types';

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): PublicUser | null => {
  const request = context.switchToHttp().getRequest<{ user?: PublicUser }>();
  return request.user ?? null;
});
