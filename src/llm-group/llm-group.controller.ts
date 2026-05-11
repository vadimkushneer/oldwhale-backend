import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
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

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.llmGroupService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateLlmGroupDto: UpdateLlmGroupDto) {
    return this.llmGroupService.update(+id, updateLlmGroupDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.llmGroupService.remove(+id);
  }
}
