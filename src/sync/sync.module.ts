import { Module } from '@nestjs/common';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { BalanceModule } from '../balance/balance.module';
import { TimeOffRequestModule } from '../time-off-request/time-off-request.module';
import { HcmClientModule } from '../hcm-client/hcm-client.module';

@Module({
  imports: [BalanceModule, TimeOffRequestModule, HcmClientModule],
  providers: [SyncService],
  controllers: [SyncController],
  exports: [SyncService],
})
export class SyncModule {}
