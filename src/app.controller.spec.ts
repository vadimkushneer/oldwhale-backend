import { Test } from '@nestjs/testing';
import { AppController } from './app.controller';

describe('AppController', () => {
  it('returns a root health-ish payload', async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [AppController] }).compile();
    expect(moduleRef.get(AppController).root()).toEqual({ name: 'oldwhale-backend', status: 'ok' });
  });
});
