import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SyncService } from './sync.service';
import { BalanceService } from '../balance/balance.service';
import { TimeOffRequestService } from '../time-off-request/time-off-request.service';
import { HcmClientService } from '../hcm-client/hcm-client.service';
import { Balance, UpdateSource } from '../balance/entities/balance.entity';
import { BalanceDiscrepancy } from '../balance/entities/balance-discrepancy.entity';
import { TimeOffRequest, RequestStatus, CancellationReason } from '../time-off-request/entities/time-off-request.entity';
import { testDbModule } from '../test-utils/test-db';

describe('SyncService', () => {
  let syncService: SyncService;
  let balanceService: BalanceService;
  let torService: TimeOffRequestService;
  let hcmClient: jest.Mocked<HcmClientService>;
  let module: TestingModule;

  beforeEach(async () => {
    const mockHcmClient = { getBalance: jest.fn(), setBalance: jest.fn() };

    module = await Test.createTestingModule({
      imports: [
        testDbModule,
        TypeOrmModule.forFeature([Balance, BalanceDiscrepancy, TimeOffRequest]),
      ],
      providers: [
        SyncService,
        BalanceService,
        TimeOffRequestService,
        { provide: HcmClientService, useValue: mockHcmClient },
      ],
    }).compile();

    syncService = module.get<SyncService>(SyncService);
    balanceService = module.get<BalanceService>(BalanceService);
    torService = module.get<TimeOffRequestService>(TimeOffRequestService);
    hcmClient = module.get(HcmClientService);
  });

  afterEach(async () => {
    await module.close();
  });

  async function seed(employeeId: string, locationId: string, value: number) {
    return balanceService.updateBalance(employeeId, locationId, value, UpdateSource.EMPLOYEE_REQUEST);
  }

  describe('processBatchSync', () => {
    it('returns correct summary for a simple update', async () => {
      await seed('emp-1', 'loc-us', 10);
      const summary = await syncService.processBatchSync([
        { employeeId: 'emp-1', locationId: 'loc-us', balance: 15 },
      ]);
      expect(summary.received).toBe(1);
      expect(summary.updated).toBe(1);
      expect(summary.cancelled).toBe(0);
      expect(summary.skipped).toBe(0);

      const balance = await balanceService.getBalance('emp-1', 'loc-us');
      expect(Number(balance.value)).toBe(15);
      expect(balance.lastUpdateSource).toBe(UpdateSource.HCM_BATCH);
    });

    it('skips records with negative balance', async () => {
      await seed('emp-1', 'loc-us', 10);
      const summary = await syncService.processBatchSync([
        { employeeId: 'emp-1', locationId: 'loc-us', balance: -5 },
      ]);
      expect(summary.skipped).toBe(1);
      expect(summary.updated).toBe(0);

      const balance = await balanceService.getBalance('emp-1', 'loc-us');
      expect(Number(balance.value)).toBe(10); // unchanged
    });

    it('upserts balance for new dimensions (work anniversary / year-start scenario)', async () => {
      // emp-new has never been seen by ExampleHR — HCM sends it in a batch
      const summary = await syncService.processBatchSync([
        { employeeId: 'emp-new', locationId: 'loc-us', balance: 20 },
      ]);
      expect(summary.received).toBe(1);
      expect(summary.updated).toBe(0); // getOrCreate sets it; syncIfDifferent sees no diff
      expect(summary.skipped).toBe(0); // NOT skipped anymore

      const balance = await balanceService.getBalance('emp-new', 'loc-us');
      expect(Number(balance.value)).toBe(20);
    });

    it('does not update when balance is within tolerance', async () => {
      await seed('emp-1', 'loc-us', 10);
      const summary = await syncService.processBatchSync([
        { employeeId: 'emp-1', locationId: 'loc-us', balance: 10.005 },
      ]);
      expect(summary.updated).toBe(0);
    });

    it('cancels pending requests when batch sync reduces balance', async () => {
      await seed('emp-1', 'loc-us', 10);
      const req = await torService.createRequest({
        employeeId: 'emp-1', locationId: 'loc-us',
        startDate: '2026-06-01', endDate: '2026-06-05', days: 5,
      });

      // Batch sync reduces balance to 2 (less than the 5-day request)
      const summary = await syncService.processBatchSync([
        { employeeId: 'emp-1', locationId: 'loc-us', balance: 2 },
      ]);

      expect(summary.cancelled).toBe(1);

      const updated = await torService.getRequest(req.id);
      expect(updated.status).toBe(RequestStatus.CANCELLED);
      expect(updated.cancellationReason).toBe(CancellationReason.BALANCE_UPDATED_BY_HCM);
    });

    it('returns accurate summary with mixed valid/invalid records', async () => {
      await seed('emp-1', 'loc-us', 10);
      await seed('emp-2', 'loc-us', 5);

      const summary = await syncService.processBatchSync([
        { employeeId: 'emp-1', locationId: 'loc-us', balance: 12 },   // updated
        { employeeId: 'emp-2', locationId: 'loc-us', balance: 5 },    // no change (within tolerance)
        { employeeId: 'emp-3', locationId: 'loc-us', balance: 8 },    // upserted (new dimension)
        { employeeId: 'emp-1', locationId: 'loc-us', balance: -1 },   // skipped (negative)
      ]);

      expect(summary.received).toBe(4);
      expect(summary.updated).toBe(1);  // emp-1 updated
      expect(summary.skipped).toBe(1);  // negative balance only
    });

    it('ensures no balance is negative after batch sync', async () => {
      await seed('emp-1', 'loc-us', 10);
      // Negative balance records should be skipped, not applied
      await syncService.processBatchSync([
        { employeeId: 'emp-1', locationId: 'loc-us', balance: -5 },
      ]);
      const balance = await balanceService.getBalance('emp-1', 'loc-us');
      expect(Number(balance.value)).toBeGreaterThanOrEqual(0);
    });
  });
});
