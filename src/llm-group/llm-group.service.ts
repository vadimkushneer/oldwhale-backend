import { Injectable } from '@nestjs/common';
import { CreateLlmGroupDto } from './dto/create-llm-group.dto';
import { UpdateLlmGroupDto } from './dto/update-llm-group.dto';

@Injectable()
export class LlmGroupService {
  create(createLlmGroupDto: CreateLlmGroupDto) {
    return 'This action adds a new llmGroup';
  }

  findAll() {
    return `This action returns all llmGroup`;
  }

  findOne(id: number) {
    return `This action returns a #${id} llmGroup`;
  }

  update(id: number, updateLlmGroupDto: UpdateLlmGroupDto) {
    return `This action updates a #${id} llmGroup`;
  }

  remove(id: number) {
    return `This action removes a #${id} llmGroup`;
  }
}
