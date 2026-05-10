import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../database/entities';
import { RequestWithUser } from './request-with-user';

interface JwtPayload {
  sub: string;
  role?: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.extractToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('missing bearer token');
    }

    const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
      secret: this.jwtSecret,
    });
    const user = await this.users.findOne({ where: { uid: payload.sub } });
    if (!user || user.disabled) {
      throw new UnauthorizedException('invalid bearer token');
    }
    request.user = user;
    return true;
  }

  private extractToken(header: string | undefined): string | undefined {
    const [kind, token] = header?.split(' ') ?? [];
    return kind === 'Bearer' ? token : undefined;
  }

  private get jwtSecret(): string {
    return (
      this.configService.get<string>('JWT_SECRET') ??
      'local-dev-change-me-to-32-chars-min!!'
    );
  }
}
