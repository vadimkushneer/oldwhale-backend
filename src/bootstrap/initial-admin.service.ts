import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { UsersService } from '../users/users.service';

@Injectable()
export class InitialAdminService implements OnApplicationBootstrap {
  constructor(private readonly users: UsersService) {}

  onApplicationBootstrap(): void {
    const username = process.env.INITIAL_ADMIN_USERNAME?.trim();
    const password = process.env.INITIAL_ADMIN_PASSWORD;
    const email = process.env.INITIAL_ADMIN_EMAIL?.trim();
    if (!username || !password || !email) return;
    if (this.users.findRowByUsername(username)) return;
    this.users.create({ username, email, password, role: 'admin' });
  }
}
