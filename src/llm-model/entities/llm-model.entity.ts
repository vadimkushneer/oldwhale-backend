import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { LlmGroup } from '../../llm-group/entities/llm-group.entity';

@Entity({ name: 'llm_models' })
@Unique('UQ_llm_models_group_name', ['llmGroupUid', 'name'])
export class LlmModel {
  @PrimaryGeneratedColumn('uuid')
  uid: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ name: 'display_name', type: 'text', nullable: true })
  displayName: string | null;

  @Column({ name: 'llm_group_uid', type: 'uuid' })
  llmGroupUid: string;

  @ManyToOne(() => LlmGroup, (llmGroup) => llmGroup.llmModels, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'llm_group_uid', referencedColumnName: 'uid' })
  llmGroup: LlmGroup;
}
