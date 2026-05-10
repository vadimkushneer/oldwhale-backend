import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseEntities } from '../database/entities';

@Module({
  imports: [TypeOrmModule.forFeature(databaseEntities)],
  exports: [TypeOrmModule],
})
export class PersistenceModule {}
