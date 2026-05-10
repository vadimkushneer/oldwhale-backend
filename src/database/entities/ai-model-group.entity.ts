import { randomUUID } from 'node:crypto';
import {
  BeforeInsert,
  Column,
  Entity,
  OneToMany,
  PrimaryColumn,
} from 'typeorm';
import { AiModelVariantEntity } from './ai-model-variant.entity';

@Entity({ name: 'ai_model_groups' })
export class AiModelGroupEntity {
  @PrimaryColumn('uuid')
  uid!: string;

  @Column({ type: 'text' })
  slug!: string;

  @Column({ type: 'text' })
  label!: string;

  @Column({ type: 'text', default: '' })
  role!: string;

  @Column({ type: 'text', default: '' })
  color!: string;

  @Column({ type: 'boolean', default: false })
  free!: boolean;

  @Column({ type: 'integer', default: 0 })
  position!: number;

  @Column({ name: 'api_key_env_var', type: 'text', default: '' })
  apiKeyEnvVar!: string;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

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

  @OneToMany(() => AiModelVariantEntity, (variant) => variant.group)
  variants!: AiModelVariantEntity[];

  @BeforeInsert()
  assignUid(): void {
    this.uid ||= randomUUID();
  }
}
