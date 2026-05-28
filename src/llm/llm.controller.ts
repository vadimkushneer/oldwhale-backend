import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { LlmService } from './llm.service';

@Controller()
export class LlmController {
  constructor(private readonly llm: LlmService) {}

  @Post('llm-group')
  createGroup(@Body() body: Record<string, unknown>) { return this.llm.createGroup(body); }

  @Get('llm-group')
  listGroups() { return this.llm.listGroups(); }

  @Get('llm-group/:uid')
  getGroup(@Param('uid') uid: string) { return this.llm.getGroup(uid); }

  @Patch('llm-group/:uid')
  updateGroup(@Param('uid') uid: string, @Body() body: Record<string, unknown>) { return this.llm.updateGroup(uid, body); }

  @Delete('llm-group/:uid')
  deleteGroup(@Param('uid') uid: string) { this.llm.deleteGroup(uid); }

  @Post('llm-group/:uid/refresh-api-key')
  refresh(@Param('uid') uid: string) { return this.llm.refreshApiKey(uid); }

  @Post('llm-group/:uid/fetch-llm-models')
  fetch(@Param('uid') uid: string) { return this.llm.fetchModels(uid); }

  @Post('llm-models')
  createModel(@Body() body: Record<string, unknown>) { return this.llm.createModel(body); }

  @Get('llm-models')
  listModels() { return this.llm.listModels(); }

  @Get('llm-models/:uid')
  getModel(@Param('uid') uid: string) { return this.llm.getModel(uid); }

  @Patch('llm-models/:uid')
  updateModel(@Param('uid') uid: string, @Body() body: Record<string, unknown>) { return this.llm.updateModel(uid, body); }

  @Delete('llm-models/:uid')
  deleteModel(@Param('uid') uid: string) { this.llm.deleteModel(uid); }
}
