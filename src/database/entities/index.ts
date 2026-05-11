import { AiChatLogEntity } from './ai-chat-log.entity';
import { AiModelGroupEntity } from './ai-model-group.entity';
import { AiModelVariantEntity } from './ai-model-variant.entity';
import { LlmGroup } from '../../llm-group/entities/llm-group.entity';
import { UserEntity } from './user.entity';
import { UserUiPreferenceEntity } from './user-ui-preference.entity';

export { EditorMode, UserRole } from './enums';
export { AiChatLogEntity } from './ai-chat-log.entity';
export { AiModelGroupEntity } from './ai-model-group.entity';
export { AiModelVariantEntity } from './ai-model-variant.entity';
export { UserEntity } from './user.entity';
export { UserUiPreferenceEntity } from './user-ui-preference.entity';

export const databaseEntities = [
  UserEntity,
  AiModelGroupEntity,
  AiModelVariantEntity,
  AiChatLogEntity,
  UserUiPreferenceEntity,
  LlmGroup,
];
