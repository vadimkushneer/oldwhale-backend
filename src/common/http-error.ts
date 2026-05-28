import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';

export function badRequest(message: string): never {
  throw new BadRequestException({ error: message });
}

export function unauthorized(message = 'Unauthorized'): never {
  throw new UnauthorizedException({ error: message });
}

export function forbidden(message = 'Forbidden'): never {
  throw new ForbiddenException({ error: message });
}

export function notFound(message = 'Not found'): never {
  throw new NotFoundException({ error: message });
}

export function conflict(message: string): never {
  throw new ConflictException({ error: message });
}
