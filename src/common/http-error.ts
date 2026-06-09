import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

export function badRequest(message: string): never {
  throw new BadRequestException({ error: message });
}

/** 402 Payment Required — used when an account lacks enough credits (Krill). */
export function paymentRequired(message: string): never {
  throw new HttpException({ error: message }, HttpStatus.PAYMENT_REQUIRED);
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

/** 502 — the upstream payment gateway returned an error or was unreachable. */
export function badGateway(message: string): never {
  throw new BadGatewayException({ error: message });
}

/** 503 — a dependency (e.g. payment gateway) is not configured/available. */
export function serviceUnavailable(message: string): never {
  throw new ServiceUnavailableException({ error: message });
}
