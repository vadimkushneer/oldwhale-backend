import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'user_ui_preferences' })
export class UserUiPreferenceEntity {
  @PrimaryColumn({ name: 'user_uid', type: 'uuid' })
  userUid!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  data!: Record<string, unknown>;

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
}
