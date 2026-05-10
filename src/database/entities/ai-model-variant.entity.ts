import { randomUUID } from 'node:crypto';
import {
  BeforeInsert,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { AiModelGroupEntity } from './ai-model-group.entity';

@Entity({ name: 'ai_model_variants' })
export class AiModelVariantEntity {
  @PrimaryColumn('uuid')
  uid!: string;

  @Column({ name: 'group_uid', type: 'uuid', nullable: true })
  groupUid!: string | null;

  @Column({ type: 'text' })
  slug!: string;

  @Column({ name: 'provider_model_id', type: 'text' })
  providerModelId!: string;

  @Column({ type: 'text', default: '' })
  label!: string;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;

  @Column({ type: 'integer', default: 0 })
  position!: number;

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

  @ManyToOne(() => AiModelGroupEntity, (group) => group.variants, {
    nullable: true,
  })
  @JoinColumn({ name: 'group_uid', referencedColumnName: 'uid' })
  group!: AiModelGroupEntity | null;

  @BeforeInsert()
  assignUid(): void {
    this.uid ||= randomUUID();
  }
}
