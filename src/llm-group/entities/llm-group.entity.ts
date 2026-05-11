import { AfterLoad, Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'llm_groups' })
export class LlmGroup {
  @PrimaryGeneratedColumn('uuid')
  uid: string;

  @Column({ name: 'api_key_env_var', type: 'varchar', length: 255 })
  apiKeyEnvVar: string;

  @Column({ name: 'models_list_request_url', type: 'text' })
  modelsListRequestUrl: string;

  // Runtime-only field; not persisted to DB.
  apiKey?: string;

  constructor(partial?: Partial<LlmGroup>) {
    if (partial) {
      Object.assign(this, partial);
    }

    if (!this.apiKey && this.apiKeyEnvVar) {
      this.readApiKeyFromEnv();
    }
  }

  @AfterLoad()
  hydrateRuntimeFields(): void {
    this.readApiKeyFromEnv();
  }

  readApiKeyFromEnv(): string | undefined {
    if (!this.apiKeyEnvVar) {
      this.apiKey = undefined;
      return this.apiKey;
    }

    this.apiKey = process.env[this.apiKeyEnvVar];
    return this.apiKey;
  }
}