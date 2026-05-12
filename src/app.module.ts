import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { BalanceModule } from './balance/balance.module';
import { TimeOffRequestModule } from './time-off-request/time-off-request.module';
import { HcmClientModule } from './hcm-client/hcm-client.module';
import { SyncModule } from './sync/sync.module';
import { Balance } from './balance/entities/balance.entity';
import { BalanceDiscrepancy } from './balance/entities/balance-discrepancy.entity';
import { TimeOffRequest } from './time-off-request/entities/time-off-request.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: process.env.DATABASE_PATH ?? './data/timeoff.db',
      entities: [Balance, BalanceDiscrepancy, TimeOffRequest],
      synchronize: process.env.NODE_ENV !== 'production',
      logging: process.env.NODE_ENV === 'development',
    }),
    ScheduleModule.forRoot(),
    HcmClientModule,
    BalanceModule,
    TimeOffRequestModule,
    SyncModule,
  ],
})
export class AppModule {}
