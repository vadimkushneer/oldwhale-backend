import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { AdminGuard, JwtAuthGuard } from '../auth/auth.guard';
import { badRequest } from '../common/http-error';
import {
  HostingDeployBranchesService,
  type HostingRepoKey,
} from './hosting-deploy-branches.service';

@Controller('api/admin/hosting')
@UseGuards(JwtAuthGuard, AdminGuard)
export class HostingDeployBranchesController {
  constructor(private readonly hosting: HostingDeployBranchesService) {}

  @Get('deploy-branches')
  getDeployBranches() {
    return this.hosting.get();
  }

  @Put('deploy-branches')
  putDeployBranches(@Body() body: { backendBranch?: string; frontendBranch?: string }) {
    return this.hosting.put(body);
  }

  @Get('repo-branches')
  listRepoBranches(@Query('repo') repo?: string) {
    if (repo !== 'backend' && repo !== 'frontend') {
      badRequest('repo must be backend or frontend');
    }
    return this.hosting.listBranches(repo as HostingRepoKey);
  }
}
