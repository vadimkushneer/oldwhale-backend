import { randomUUID } from 'node:crypto';
import { BeforeInsert, Column, Entity, PrimaryColumn } from 'typeorm';
import { UserRole } from './enums';

@Entity({ name: 'users' })
export class UserEntity {
  @PrimaryColumn('uuid')
  uid!: string;

  @Column({ type: 'text', unique: true })
  username!: string;

  @Column({ type: 'text', unique: true })
  email!: string;

  @Column({ name: 'password_hash', type: 'text' })
  passwordHash!: string;

  @Column({ type: 'text', default: UserRole.User })
  role!: UserRole;

  @Column({ type: 'boolean', default: false })
  disabled!: boolean;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt!: Date | null;

  @Column({
    name: 'created_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;

  @Column({
    name: 'updated_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  updatedAt!: Date;

  @BeforeInsert()
  assignUid(): void {
    this.uid ||= randomUUID();
  }
}
