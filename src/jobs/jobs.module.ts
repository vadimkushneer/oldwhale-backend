import { Module } from '@nestjs/common';
import { InMemoryJobRunnerService } from './in-memory-job-runner.service';

@Module({
  providers: [InMemoryJobRunnerService],
  exports: [InMemoryJobRunnerService],
})
export class JobsModule {}
