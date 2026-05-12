import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Balance } from './entities/balance.entity';
import { BalanceDiscrepancy } from './entities/balance-discrepancy.entity';
import { BalanceService } from './balance.service';
import { BalanceController } from './balance.controller';
import { HcmClientModule } from '../hcm-client/hcm-client.module';

@Module({
  imports: [TypeOrmModule.forFeature([Balance, BalanceDiscrepancy]), HcmClientModule],
  providers: [BalanceService],
  controllers: [BalanceController],
  exports: [BalanceService],
})
export class BalanceModule {}
