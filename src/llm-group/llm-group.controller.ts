import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { LlmGroupService } from './llm-group.service';
import { CreateLlmGroupDto } from './dto/create-llm-group.dto';
import { UpdateLlmGroupDto } from './dto/update-llm-group.dto';

@Controller('llm-group')
export class LlmGroupController {
  constructor(private readonly llmGroupService: LlmGroupService) {}

  @Post()
  create(@Body() createLlmGroupDto: CreateLlmGroupDto) {
    return this.llmGroupService.create(createLlmGroupDto);
  }

  @Get()
  findAll() {
    return this.llmGroupService.findAll();
  }

  @Get(':uid')
  findOne(@Param('uid') uid: string) {
    return this.llmGroupService.findOne(uid);
  }

  @Patch(':uid')
  update(
    @Param('uid') uid: string,
    @Body() updateLlmGroupDto: UpdateLlmGroupDto,
  ) {
    return this.llmGroupService.update(uid, updateLlmGroupDto);
  }

  @Delete(':uid')
  remove(@Param('uid') uid: string) {
    return this.llmGroupService.remove(uid);
  }

  @Post(':uid/refresh-api-key')
  refreshApiKey(@Param('uid') uid: string) {
    return this.llmGroupService.refreshRuntimeApiKey(uid);
  }

  @Post(':uid/fetch-llm-models')
  fetchLlmModelsList(@Param('uid') uid: string) {
    return this.llmGroupService.fetchLlmModelsList(uid);
  }
}
