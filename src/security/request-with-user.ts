import { Request } from 'express';
import { UserEntity } from '../database/entities';

export interface RequestWithUser extends Request {
  user?: UserEntity;
}
