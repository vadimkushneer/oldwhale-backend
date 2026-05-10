import { randomUUID } from 'node:crypto';
import { BeforeInsert, Column, Entity, PrimaryColumn } from 'typeorm';
import { EditorMode } from './enums';

@Entity({ name: 'ai_chat_logs' })
export class AiChatLogEntity {
  @PrimaryColumn('uuid')
  uid!: string;

  @Column({ name: 'user_uid', type: 'uuid', nullable: true })
  userUid!: string | null;

  @Column({ name: 'group_uid', type: 'uuid', nullable: true })
  groupUid!: string | null;

  @Column({ name: 'variant_uid', type: 'uuid', nullable: true })
  variantUid!: string | null;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'text' })
  reply!: string;

  @Column({ name: 'user_message_uid', type: 'uuid' })
  userMessageUid!: string;

  @Column({ name: 'assistant_message_uid', type: 'uuid' })
  assistantMessageUid!: string;

  @Column({ name: 'client_ip', type: 'inet', nullable: true })
  clientIp!: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent!: string | null;

  @Column({ name: 'editor_mode', type: 'text', default: EditorMode.Note })
  editorMode!: EditorMode;

  @Column({ name: 'note_context', type: 'jsonb', nullable: true })
  noteContext!: Record<string, unknown> | null;

  @Column({
    name: 'created_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;

  @BeforeInsert()
  assignUid(): void {
    this.uid ||= randomUUID();
  }
}
