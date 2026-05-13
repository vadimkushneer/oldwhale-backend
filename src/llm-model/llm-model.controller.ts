import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CreateLlmModelDto } from './dto/create-llm-model.dto';
import { UpdateLlmModelDto } from './dto/update-llm-model.dto';
import { LlmModelService } from './llm-model.service';

@Controller('llm-models')
export class LlmModelController {
  constructor(private readonly llmModelService: LlmModelService) {}

  @Post()
  create(@Body() createLlmModelDto: CreateLlmModelDto) {
    return this.llmModelService.create(createLlmModelDto);
  }

  @Get()
  findAll() {
    return this.llmModelService.findAll();
  }

  @Get(':uid')
  findOne(@Param('uid') uid: string) {
    return this.llmModelService.findOne(uid);
  }

  @Patch(':uid')
  update(
    @Param('uid') uid: string,
    @Body() updateLlmModelDto: UpdateLlmModelDto,
  ) {
    return this.llmModelService.update(uid, updateLlmModelDto);
  }

  @Delete(':uid')
  remove(@Param('uid') uid: string) {
    return this.llmModelService.remove(uid);
  }
}
