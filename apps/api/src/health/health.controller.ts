import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DbService } from '../common/db.service';
import { Public } from '../common/request';

@Controller('v1/health')
export class HealthController {
  constructor(private readonly db: DbService) {}
  @Public() @Get() live() {
    return { status: 'ok' };
  }
  @Public()
  @Get('ready')
  async ready() {
    try {
      await this.db.query('SELECT 1');
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException();
    }
  }
}
