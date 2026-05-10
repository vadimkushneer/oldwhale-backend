import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { IsNull, Repository } from 'typeorm';
import {
  AiChatLogEntity,
  AiModelGroupEntity,
  AiModelVariantEntity,
  EditorMode,
  UserEntity,
  UserRole,
  UserUiPreferenceEntity,
} from '../database/entities';

export type JsonBody = Record<string, unknown>;

interface RequestMetadata {
  user?: UserEntity;
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class ApiFacade {
  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(AiModelGroupEntity)
    private readonly groups: Repository<AiModelGroupEntity>,
    @InjectRepository(AiModelVariantEntity)
    private readonly variants: Repository<AiModelVariantEntity>,
    @InjectRepository(AiChatLogEntity)
    private readonly chatLogs: Repository<AiChatLogEntity>,
    @InjectRepository(UserUiPreferenceEntity)
    private readonly uiPrefs: Repository<UserUiPreferenceEntity>,
  ) {}

  getHealth(): { status: string } {
    return { status: 'ok' };
  }

  async register(body: JsonBody): Promise<JsonBody> {
    const username = this.requiredText(body, 'username');
    const email = this.requiredText(body, 'email').toLowerCase();
    const password = this.requiredText(body, 'password');
    if (username.length < 2 || password.length < 6) {
      throw new BadRequestException('username or password is too short');
    }
    await this.ensureUniqueUser(username, email);
    const user = this.users.create({
      username,
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: UserRole.User,
      disabled: false,
      lastLoginAt: null,
    });
    await this.users.save(user);
    return this.authResponse(user);
  }

  async login(body: JsonBody): Promise<JsonBody> {
    const username = this.requiredText(body, 'username');
    const password = this.requiredText(body, 'password');
    const user = await this.users.findOne({ where: { username } });
    if (
      !user ||
      user.disabled ||
      !(await bcrypt.compare(password, user.passwordHash))
    ) {
      throw new UnauthorizedException('invalid credentials');
    }
    user.lastLoginAt = new Date();
    user.updatedAt = new Date();
    await this.users.save(user);
    return this.authResponse(user);
  }

  getMe(user: UserEntity): JsonBody {
    return this.toUser(user);
  }

  async listUsers(): Promise<JsonBody> {
    const users = await this.users.find({ order: { createdAt: 'DESC' } });
    return { users: users.map((user) => this.toUser(user)) };
  }

  async createUser(body: JsonBody): Promise<JsonBody> {
    const username = this.requiredText(body, 'username');
    const email = this.requiredText(body, 'email').toLowerCase();
    const password = this.requiredText(body, 'password');
    if (password.length < 4) {
      throw new BadRequestException('password is too short');
    }
    await this.ensureUniqueUser(username, email);
    const user = this.users.create({
      username,
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: this.userRole(body.role) ?? UserRole.User,
      disabled: false,
      lastLoginAt: null,
    });
    await this.users.save(user);
    return { user: this.toUser(user) };
  }

  async patchUser(uid: string, body: JsonBody): Promise<JsonBody> {
    const user = await this.requireUser(uid);
    const role = this.userRole(body.role);
    if (role) {
      user.role = role;
    }
    if (typeof body.disabled === 'boolean') {
      user.disabled = body.disabled;
    }
    user.updatedAt = new Date();
    await this.users.save(user);
    return { user: this.toUser(user) };
  }

  async deleteUser(uid: string): Promise<void> {
    const user = await this.requireUser(uid);
    await this.users.remove(user);
  }

  async listPublicModels(): Promise<JsonBody> {
    await this.ensureDefaultCatalog();
    const groups = await this.activeGroupsWithVariants();
    return { groups: groups.map((group) => this.toPublicGroup(group)) };
  }

  async listAdminGroups(): Promise<JsonBody> {
    await this.ensureDefaultCatalog();
    const groups = await this.activeGroupsWithVariants();
    return { groups: groups.map((group) => this.toAdminGroup(group)) };
  }

  async createGroup(body: JsonBody): Promise<JsonBody> {
    const group = this.groups.create({
      slug: this.requiredText(body, 'slug'),
      label: this.requiredText(body, 'label'),
      role: this.optionalText(body, 'role', ''),
      color: this.optionalText(body, 'color', ''),
      free: this.optionalBoolean(body, 'free', false),
      position: this.optionalNumber(body, 'position', 0),
      apiKeyEnvVar: this.optionalText(body, 'api_key_env_var', ''),
      deletedAt: null,
    });
    await this.groups.save(group);
    group.variants = [];
    return { group: this.toAdminGroup(group) };
  }

  async patchGroup(uid: string, body: JsonBody): Promise<JsonBody> {
    const group = await this.requireGroup(uid);
    this.patchText(body, group, 'slug', 'slug');
    this.patchText(body, group, 'label', 'label');
    this.patchText(body, group, 'role', 'role');
    this.patchText(body, group, 'color', 'color');
    this.patchText(body, group, 'api_key_env_var', 'apiKeyEnvVar');
    if (typeof body.free === 'boolean') {
      group.free = body.free;
    }
    if (typeof body.position === 'number') {
      group.position = body.position;
    }
    group.updatedAt = new Date();
    await this.groups.save(group);
    const withVariants = await this.groupWithVariants(uid);
    return { group: this.toAdminGroup(withVariants) };
  }

  async deleteGroup(uid: string): Promise<void> {
    const group = await this.requireGroup(uid);
    group.deletedAt = new Date();
    group.updatedAt = new Date();
    await this.groups.save(group);
  }

  async reorderGroups(body: JsonBody): Promise<void> {
    const uids = this.uidList(body);
    await Promise.all(
      uids.map(async (uid, position) => {
        const group = await this.requireGroup(uid);
        group.position = position;
        group.updatedAt = new Date();
        await this.groups.save(group);
      }),
    );
  }

  async createVariant(groupUid: string, body: JsonBody): Promise<JsonBody> {
    await this.requireGroup(groupUid);
    const variant = this.variants.create({
      groupUid,
      slug: this.requiredText(body, 'slug'),
      providerModelId: this.requiredText(body, 'provider_model_id'),
      label: this.optionalText(body, 'label', ''),
      isDefault: this.optionalBoolean(body, 'is_default', false),
      position: this.optionalNumber(body, 'position', 0),
      deletedAt: null,
    });
    await this.variants.save(variant);
    return { variant: this.toAdminVariant(variant) };
  }

  async patchVariant(uid: string, body: JsonBody): Promise<JsonBody> {
    const variant = await this.requireVariant(uid);
    this.patchText(body, variant, 'slug', 'slug');
    this.patchText(body, variant, 'provider_model_id', 'providerModelId');
    this.patchText(body, variant, 'label', 'label');
    if (typeof body.is_default === 'boolean') {
      variant.isDefault = body.is_default;
    }
    if (typeof body.position === 'number') {
      variant.position = body.position;
    }
    variant.updatedAt = new Date();
    await this.variants.save(variant);
    return { variant: this.toAdminVariant(variant) };
  }

  async deleteVariant(uid: string): Promise<void> {
    const variant = await this.requireVariant(uid);
    variant.deletedAt = new Date();
    variant.updatedAt = new Date();
    await this.variants.save(variant);
  }

  async reorderVariants(groupUid: string, body: JsonBody): Promise<void> {
    await this.requireGroup(groupUid);
    const uids = this.uidList(body);
    await Promise.all(
      uids.map(async (uid, position) => {
        const variant = await this.requireVariant(uid);
        if (variant.groupUid !== groupUid) {
          throw new BadRequestException('variant does not belong to group');
        }
        variant.position = position;
        variant.updatedAt = new Date();
        await this.variants.save(variant);
      }),
    );
  }

  async importModels(groupUid: string, body: JsonBody): Promise<JsonBody> {
    const group = await this.groupWithVariants(groupUid);
    const providerId = this.requiredText(body, 'providerId');
    const modelsUrl = this.requiredText(body, 'modelsUrl');
    const envVarName = this.requiredText(body, 'envVarName');
    group.apiKeyEnvVar = envVarName;
    group.updatedAt = new Date();
    await this.groups.save(group);
    return {
      group: this.toAdminGroup(group),
      imported: 0,
      providerId,
      modelsUrl,
    };
  }

  async acceptChat(
    body: JsonBody,
    metadata: RequestMetadata,
  ): Promise<JsonBody> {
    const message = this.requiredText(body, 'message');
    const requestUid = randomUUID();
    const userMessageUid = randomUUID();
    const assistantMessageUid = randomUUID();
    const log = this.chatLogs.create({
      userUid: metadata.user?.uid ?? null,
      groupUid: this.optionalUuid(body, 'group_uid'),
      variantUid: this.optionalUuid(body, 'variant_uid'),
      message,
      reply: '',
      userMessageUid,
      assistantMessageUid,
      clientIp: metadata.ip ?? null,
      userAgent: metadata.userAgent ?? null,
      editorMode: this.editorMode(body.editor_mode) ?? EditorMode.Note,
      noteContext: this.objectOrNull(body.note_context),
    });
    await this.chatLogs.save(log);
    return {
      request_uid: requestUid,
      user_message_uid: userMessageUid,
      assistant_message_uid: assistantMessageUid,
    };
  }

  async listChatLogs(query: JsonBody): Promise<JsonBody> {
    const limit = Math.min(
      Math.max(this.optionalNumber(query, 'limit', 50), 1),
      200,
    );
    const offset = Math.max(this.optionalNumber(query, 'offset', 0), 0);
    const [items, total] = await this.chatLogs.findAndCount({
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return { items: items.map((item) => this.toChatLog(item)), total };
  }

  async getUiSettings(user: UserEntity): Promise<JsonBody> {
    const prefs = await this.ensureUiPrefs(user.uid);
    return this.uiSettingsResponse(prefs);
  }

  async putUiSettings(user: UserEntity, body: JsonBody): Promise<JsonBody> {
    const prefs = await this.ensureUiPrefs(user.uid);
    prefs.data = this.objectOrNull(body) ?? {};
    prefs.updatedAt = new Date();
    await this.uiPrefs.save(prefs);
    return this.uiSettingsResponse(prefs);
  }

  envCheck(body: JsonBody): JsonBody {
    const name = this.requiredText(body, 'name');
    return { name, present: Boolean(process.env[name]) };
  }

  modelProviders(): JsonBody {
    return {
      providers: [
        {
          id: 'anthropic',
          label: 'Anthropic',
          modelsUrl: 'https://api.anthropic.com/v1/models',
        },
        {
          id: 'ollama',
          label: 'Ollama',
          modelsUrl:
            this.configService.get<string>('OLLAMA_BASE_URL') ??
            'http://localhost:11434',
        },
      ],
    };
  }

  private async ensureUniqueUser(
    username: string,
    email: string,
  ): Promise<void> {
    const conflict = await this.users.findOne({
      where: [{ username }, { email }],
    });
    if (conflict) {
      throw new ConflictException('user already exists');
    }
  }

  private async authResponse(user: UserEntity): Promise<JsonBody> {
    const token = await this.jwtService.signAsync(
      { sub: user.uid, role: user.role },
      { secret: this.jwtSecret, expiresIn: '24h' },
    );
    return { token, user: this.toUser(user) };
  }

  private async ensureDefaultCatalog(): Promise<void> {
    const count = await this.groups.count({ where: { deletedAt: IsNull() } });
    if (count > 0) {
      return;
    }
    const group = await this.groups.save(
      this.groups.create({
        slug: 'local',
        label: 'Local',
        role: 'general',
        color: '#64748b',
        free: true,
        position: 0,
        apiKeyEnvVar: 'OLLAMA_API_KEY',
        deletedAt: null,
      }),
    );
    await this.variants.save(
      this.variants.create({
        groupUid: group.uid,
        slug: 'qwen2-5-7b-instruct',
        providerModelId: 'qwen2.5:7b-instruct',
        label: 'Qwen 2.5 7B Instruct',
        isDefault: true,
        position: 0,
        deletedAt: null,
      }),
    );
  }

  private async activeGroupsWithVariants(): Promise<AiModelGroupEntity[]> {
    const groups = await this.groups.find({
      where: { deletedAt: IsNull() },
      relations: { variants: true },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
    for (const group of groups) {
      group.variants = (group.variants ?? [])
        .filter((variant) => !variant.deletedAt)
        .sort((left, right) => left.position - right.position);
    }
    return groups;
  }

  private async groupWithVariants(uid: string): Promise<AiModelGroupEntity> {
    const group = await this.groups.findOne({
      where: { uid, deletedAt: IsNull() },
      relations: { variants: true },
    });
    if (!group) {
      throw new NotFoundException('group not found');
    }
    group.variants = (group.variants ?? []).filter(
      (variant) => !variant.deletedAt,
    );
    return group;
  }

  private async requireGroup(uid: string): Promise<AiModelGroupEntity> {
    const group = await this.groups.findOne({
      where: { uid, deletedAt: IsNull() },
    });
    if (!group) {
      throw new NotFoundException('group not found');
    }
    return group;
  }

  private async requireVariant(uid: string): Promise<AiModelVariantEntity> {
    const variant = await this.variants.findOne({
      where: { uid, deletedAt: IsNull() },
    });
    if (!variant) {
      throw new NotFoundException('variant not found');
    }
    return variant;
  }

  private async requireUser(uid: string): Promise<UserEntity> {
    const user = await this.users.findOne({ where: { uid } });
    if (!user) {
      throw new NotFoundException('user not found');
    }
    return user;
  }

  private async ensureUiPrefs(
    userUid: string,
  ): Promise<UserUiPreferenceEntity> {
    const existing = await this.uiPrefs.findOne({ where: { userUid } });
    if (existing) {
      return existing;
    }
    return this.uiPrefs.save(
      this.uiPrefs.create({ userUid, data: this.defaultUiSettings() }),
    );
  }

  private toUser(user: UserEntity): JsonBody {
    return {
      uid: user.uid,
      username: user.username,
      email: user.email,
      role: user.role,
      disabled: user.disabled,
      last_login_at: user.lastLoginAt,
      created_at: user.createdAt,
      updated_at: user.updatedAt,
    };
  }

  private toPublicGroup(group: AiModelGroupEntity): JsonBody {
    return {
      uid: group.uid,
      slug: group.slug,
      label: group.label,
      role: group.role,
      color: group.color,
      free: group.free,
      variants: (group.variants ?? []).map((variant) =>
        this.toPublicVariant(variant),
      ),
      created_at: group.createdAt,
      updated_at: group.updatedAt,
    };
  }

  private toPublicVariant(variant: AiModelVariantEntity): JsonBody {
    return {
      uid: variant.uid,
      slug: variant.slug,
      label: variant.label,
      is_default: variant.isDefault,
      created_at: variant.createdAt,
      updated_at: variant.updatedAt,
    };
  }

  private toAdminGroup(group: AiModelGroupEntity): JsonBody {
    return {
      ...this.toPublicGroup(group),
      position: group.position,
      api_key_env_var: group.apiKeyEnvVar,
      api_key_present: Boolean(
        group.apiKeyEnvVar && process.env[group.apiKeyEnvVar],
      ),
      deleted_at: group.deletedAt,
      variants: (group.variants ?? []).map((variant) =>
        this.toAdminVariant(variant),
      ),
    };
  }

  private toAdminVariant(variant: AiModelVariantEntity): JsonBody {
    return {
      uid: variant.uid,
      group_uid: variant.groupUid,
      slug: variant.slug,
      provider_model_id: variant.providerModelId,
      label: variant.label,
      is_default: variant.isDefault,
      position: variant.position,
      deleted_at: variant.deletedAt,
      created_at: variant.createdAt,
      updated_at: variant.updatedAt,
    };
  }

  private toChatLog(log: AiChatLogEntity): JsonBody {
    return {
      uid: log.uid,
      created_at: log.createdAt,
      user_uid: log.userUid,
      group_uid: log.groupUid,
      variant_uid: log.variantUid,
      message: log.message,
      reply: log.reply,
      user_message_uid: log.userMessageUid,
      assistant_message_uid: log.assistantMessageUid,
      client_ip: log.clientIp,
      user_agent: log.userAgent,
      editor_mode: log.editorMode,
      note_context: log.noteContext,
    };
  }

  private uiSettingsResponse(prefs: UserUiPreferenceEntity): JsonBody {
    return Object.keys(prefs.data).length > 0
      ? prefs.data
      : this.defaultUiSettings();
  }

  private defaultUiSettings(): JsonBody {
    return {
      aiChatLogTable: {
        columns: {
          uid: true,
          time: true,
          user: true,
          message: true,
          reply: true,
          model: true,
          message_ids: true,
          ip_ua: true,
          editor_mode: true,
          note_context: true,
        },
        updated_at: null,
      },
    };
  }

  private requiredText(body: JsonBody, key: string): string {
    const value = body[key];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new BadRequestException(`${key} is required`);
    }
    return value.trim();
  }

  private optionalText(body: JsonBody, key: string, fallback: string): string {
    const value = body[key];
    return typeof value === 'string' ? value : fallback;
  }

  private optionalBoolean(
    body: JsonBody,
    key: string,
    fallback: boolean,
  ): boolean {
    const value = body[key];
    return typeof value === 'boolean' ? value : fallback;
  }

  private optionalNumber(
    body: JsonBody,
    key: string,
    fallback: number,
  ): number {
    const value = body[key];
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : fallback;
  }

  private optionalUuid(body: JsonBody, key: string): string | null {
    const value = body[key];
    return typeof value === 'string' && value.trim() !== '' ? value : null;
  }

  private uidList(body: JsonBody): string[] {
    const value = body.uids;
    if (!Array.isArray(value) || value.some((uid) => typeof uid !== 'string')) {
      throw new BadRequestException('uids must be a string array');
    }
    return value as string[];
  }

  private objectOrNull(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private editorMode(value: unknown): EditorMode | null {
    return Object.values(EditorMode).includes(value as EditorMode)
      ? (value as EditorMode)
      : null;
  }

  private userRole(value: unknown): UserRole | null {
    return Object.values(UserRole).includes(value as UserRole)
      ? (value as UserRole)
      : null;
  }

  private patchText<T extends object>(
    body: JsonBody,
    target: T,
    sourceKey: string,
    targetKey: keyof T,
  ): void {
    const value = body[sourceKey];
    if (typeof value === 'string') {
      target[targetKey] = value as T[keyof T];
    }
  }

  private get jwtSecret(): string {
    return (
      this.configService.get<string>('JWT_SECRET') ??
      'local-dev-change-me-to-32-chars-min!!'
    );
  }
}
