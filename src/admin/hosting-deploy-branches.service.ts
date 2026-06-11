import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Injectable } from '@nestjs/common';
import { badGateway, badRequest } from '../common/http-error';
import { nowIso } from '../common/time';
import {
  readGithubToken,
  readHostingBackendRepo,
  readHostingDeployBranchesPath,
  readHostingFrontendRepo,
} from '../config/env';

export type HostingRepoKey = 'backend' | 'frontend';

export interface HostingDeployBranches {
  backendBranch: string;
  frontendBranch: string;
  updatedAt: string | null;
}

interface DeployBranchesFile {
  backend_branch: string;
  frontend_branch: string;
  updated_at: string | null;
}

const DEFAULT_BRANCH = 'main';
const BRANCH_NAME_RE = /^[A-Za-z0-9._/-]+$/;

@Injectable()
export class HostingDeployBranchesService {
  get(): HostingDeployBranches {
    return this.readFile();
  }

  async listBranches(repo: HostingRepoKey): Promise<{ branches: string[] }> {
    const slug = repo === 'backend' ? readHostingBackendRepo() : readHostingFrontendRepo();
    const branches: string[] = [];
    let page = 1;

    while (true) {
      const url = `https://api.github.com/repos/${slug}/branches?per_page=100&page=${page}`;
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'oldwhale-backend',
      };
      const token = readGithubToken();
      if (token) headers.Authorization = `Bearer ${token}`;

      let response: Response;
      try {
        response = await fetch(url, { headers });
      } catch {
        badGateway('Failed to reach GitHub');
      }

      if (!response.ok) {
        badGateway(`GitHub branch list failed (${response.status})`);
      }

      const pageItems = (await response.json()) as Array<{ name?: string }>;
      if (!Array.isArray(pageItems) || pageItems.length === 0) break;

      for (const item of pageItems) {
        if (typeof item.name === 'string' && item.name) branches.push(item.name);
      }

      if (pageItems.length < 100) break;
      page += 1;
    }

    branches.sort((a, b) => a.localeCompare(b));
    return { branches };
  }

  async put(body: { backendBranch?: string; frontendBranch?: string }): Promise<HostingDeployBranches> {
    const current = this.readFile();
    const backendBranch = this.normalizeBranch(body.backendBranch ?? current.backendBranch, 'backendBranch');
    const frontendBranch = this.normalizeBranch(body.frontendBranch ?? current.frontendBranch, 'frontendBranch');

    const [backendBranches, frontendBranches] = await Promise.all([
      this.listBranches('backend'),
      this.listBranches('frontend'),
    ]);

    if (!backendBranches.branches.includes(backendBranch)) {
      badRequest(`Unknown backend branch: ${backendBranch}`);
    }
    if (!frontendBranches.branches.includes(frontendBranch)) {
      badRequest(`Unknown frontend branch: ${frontendBranch}`);
    }

    const updatedAt = nowIso();
    this.writeFile({ backend_branch: backendBranch, frontend_branch: frontendBranch, updated_at: updatedAt });
    return {
      backendBranch,
      frontendBranch,
      updatedAt,
    };
  }

  private normalizeBranch(value: string, field: string): string {
    const branch = value.trim();
    if (!branch) badRequest(`${field} is required`);
    if (!BRANCH_NAME_RE.test(branch)) badRequest(`Invalid ${field}`);
    return branch;
  }

  private readFile(): HostingDeployBranches {
    const path = readHostingDeployBranchesPath();
    try {
      const raw = readFileSync(path, 'utf8');
      const parsed = JSON.parse(raw) as Partial<DeployBranchesFile>;
      return {
        backendBranch: this.normalizeStoredBranch(parsed.backend_branch, DEFAULT_BRANCH),
        frontendBranch: this.normalizeStoredBranch(parsed.frontend_branch, DEFAULT_BRANCH),
        updatedAt: typeof parsed.updated_at === 'string' ? parsed.updated_at : null,
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return {
          backendBranch: DEFAULT_BRANCH,
          frontendBranch: DEFAULT_BRANCH,
          updatedAt: null,
        };
      }
      badRequest('Invalid hosting deploy branches config');
    }
  }

  private normalizeStoredBranch(value: unknown, fallback: string): string {
    if (typeof value !== 'string') return fallback;
    const branch = value.trim();
    if (!branch || !BRANCH_NAME_RE.test(branch)) return fallback;
    return branch;
  }

  private writeFile(data: DeployBranchesFile): void {
    const path = readHostingDeployBranchesPath();
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o664 });
    renameSync(tmp, path);
  }
}
