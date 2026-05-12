import { TypeOrmModule } from '@nestjs/typeorm';
import { Balance } from '../balance/entities/balance.entity';
import { BalanceDiscrepancy } from '../balance/entities/balance-discrepancy.entity';
import { TimeOffRequest } from '../time-off-request/entities/time-off-request.entity';

export const testDbModule = TypeOrmModule.forRoot({
  type: 'better-sqlite3',
  database: ':memory:',
  entities: [Balance, BalanceDiscrepancy, TimeOffRequest],
  synchronize: true,
  dropSchema: true,
});
