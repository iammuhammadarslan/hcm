import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as fc from 'fast-check';
import { BalanceService } from './balance.service';
import { Balance, UpdateSource } from './entities/balance.entity';
import { BalanceDiscrepancy, DetectedDuring, ResolutionAction } from './entities/balance-discrepancy.entity';
import { TimeOffRequest } from '../time-off-request/entities/time-off-request.entity';
import { TimeOffRequestService } from '../time-off-request/time-off-request.service';
import { HcmClientService } from '../hcm-client/hcm-client.service';
import { RequestStatus } from '../time-off-request/entities/time-off-request.entity';
import { InsufficientBalanceException } from '../common/exceptions/app.exception';
import { testDbModule } from '../test-utils/test-db';

describe('Property-Based Tests', () => {
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
        BalanceService,
        TimeOffRequestService,
        { provide: HcmClientService, useValue: mockHcmClient },
      ],
    }).compile();

    balanceService = module.get<BalanceService>(BalanceService);
    torService = module.get<TimeOffRequestService>(TimeOffRequestService);
    hcmClient = module.get(HcmClientService);
  });

  afterEach(async () => {
    await module.close();
  });

  // ── Property 1: Balance Conservation Invariant ────────────────────────────
  // For any initial balance B and sequence of approved requests,
  // sum(approved.days) + currentBalance == B
  it('Property 1: balance conservation — sum(approved) + currentBalance == initialBalance', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 10, max: 100 }),
        fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 1, maxLength: 4 }),
        async (initialBalance, requestDays) => {
          // Use unique employee per run to avoid cross-test contamination
          const empId = `emp-prop1-${Math.random().toString(36).slice(2)}`;
          const locId = 'loc-us';

          await balanceService.updateBalance(empId, locId, initialBalance, UpdateSource.EMPLOYEE_REQUEST);

          let totalApproved = 0;
          for (const days of requestDays) {
            const balance = await balanceService.getBalance(empId, locId);
            if (days > Number(balance.value)) continue; // skip if insufficient

            hcmClient.getBalance
              .mockResolvedValueOnce(Number(balance.value)) // pre-approval: HCM matches local (no discrepancy)
              .mockResolvedValueOnce(Number(balance.value) - days); // post-write read confirms deduction

            hcmClient.setBalance.mockResolvedValueOnce(undefined);

            const req = await torService.createRequest({
              employeeId: empId, locationId: locId,
              startDate: '2026-06-01', endDate: '2026-06-01', days,
            });
            await torService.approveRequest(req.id);
            totalApproved += days;
          }

          const finalBalance = await balanceService.getBalance(empId, locId);
          const diff = Math.abs(initialBalance - totalApproved - Number(finalBalance.value));
          return diff < 0.01;
        },
      ),
      { numRuns: 50 },
    );
  });

  // ── Property 2: Insufficient Balance Always Rejected ─────────────────────
  // For any balance B >= 0 and request D > B, submission must return 422
  it('Property 2: insufficient balance always rejected with 422', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.float({ min: 0, max: 50, noNaN: true }),
        fc.float({ min: Math.fround(0.01), max: 10, noNaN: true }),
        async (balance, extra) => {
          const empId = `emp-prop2-${Math.random().toString(36).slice(2)}`;
          const locId = 'loc-us';
          const roundedBalance = Math.round(balance * 100) / 100;
          const requestDays = Math.round((roundedBalance + extra) * 100) / 100;

          await balanceService.updateBalance(empId, locId, roundedBalance, UpdateSource.EMPLOYEE_REQUEST);

          try {
            await torService.createRequest({
              employeeId: empId, locationId: locId,
              startDate: '2026-06-01', endDate: '2026-06-01', days: requestDays,
            });
            return false; // should have thrown
          } catch (err) {
            return err instanceof InsufficientBalanceException;
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  // ── Property 3: Balance Update Records Correct Source ────────────────────
  it('Property 3: balance update records correct source and non-decreasing timestamp', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(
          UpdateSource.HCM_REALTIME,
          UpdateSource.HCM_BATCH,
          UpdateSource.HCM_CONFLICT_RESOLUTION,
        ),
        fc.float({ min: 0, max: 100, noNaN: true }),
        async (source, value) => {
          const empId = `emp-prop3-${Math.random().toString(36).slice(2)}`;
          const locId = 'loc-us';
          const rounded = Math.round(value * 100) / 100;

          const before = new Date();
          // Truncate to second precision to match SQLite's UpdateDateColumn storage
          before.setMilliseconds(0);
          const result = await balanceService.updateBalance(empId, locId, rounded, source);
          const after = new Date();

          return (
            result.lastUpdateSource === source &&
            new Date(result.updatedAt) >= before &&
            new Date(result.updatedAt) <= after
          );
        },
      ),
      { numRuns: 50 },
    );
  });

  // ── Property 5: Batch Sync Non-Negativity ────────────────────────────────
  it('Property 5: after any batch sync, no local balance is negative', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            balance: fc.oneof(
              fc.float({ min: 0, max: 100, noNaN: true }),
              fc.constant(-5), // invalid — should be skipped
            ),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        async (records) => {
          const empId = `emp-prop5-${Math.random().toString(36).slice(2)}`;
          const locId = 'loc-us';
          await balanceService.updateBalance(empId, locId, 50, UpdateSource.EMPLOYEE_REQUEST);

          const syncRecords = records.map((r) => ({
            employeeId: empId,
            locationId: locId,
            balance: r.balance,
          }));

          // Import SyncService inline to avoid circular dep in test
          const { SyncService } = require('../sync/sync.service');
          const syncService = new SyncService(balanceService, torService, hcmClient);
          await syncService.processBatchSync(syncRecords);

          const balance = await balanceService.getBalance(empId, locId);
          return Number(balance.value) >= 0;
        },
      ),
      { numRuns: 30 },
    );
  });

  // ── Property 9: Discrepancy Event Completeness ───────────────────────────
  it('Property 9: every discrepancy event has all required non-null fields', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.float({ min: 0, max: 100, noNaN: true }),
        fc.float({ min: 0, max: 100, noNaN: true }),
        fc.constantFrom(...Object.values(DetectedDuring)),
        async (localVal, hcmVal, detectedDuring) => {
          if (Math.abs(localVal - hcmVal) <= 0.01) return true; // no discrepancy to record

          const empId = `emp-prop9-${Math.random().toString(36).slice(2)}`;
          const locId = 'loc-us';
          await balanceService.updateBalance(empId, locId, Math.round(localVal * 100) / 100, UpdateSource.EMPLOYEE_REQUEST);

          const sourceMap: Record<DetectedDuring, UpdateSource> = {
            [DetectedDuring.REALTIME_SYNC]: UpdateSource.HCM_REALTIME,
            [DetectedDuring.BATCH_SYNC]: UpdateSource.HCM_BATCH,
            [DetectedDuring.POST_WRITE_READ]: UpdateSource.HCM_REALTIME,
            [DetectedDuring.CONFLICT_RESOLUTION]: UpdateSource.HCM_CONFLICT_RESOLUTION,
          };

          await balanceService.syncIfDifferent(
            empId, locId,
            Math.round(hcmVal * 100) / 100,
            sourceMap[detectedDuring],
            detectedDuring,
          );

          const discrepancies = await balanceService.getDiscrepancies({ employeeId: empId });
          if (discrepancies.length === 0) return true;

          const d = discrepancies[0];
          return (
            d.employeeId != null &&
            d.locationId != null &&
            d.localValue != null &&
            d.hcmValue != null &&
            d.resolutionAction != null &&
            d.detectedDuring != null &&
            d.detectedAt != null
          );
        },
      ),
      { numRuns: 50 },
    );
  });

  // ── Property 11: State Machine Conflict Rejection ────────────────────────
  it('Property 11: approving/rejecting non-PENDING request always returns 409', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('approve', 'reject'),
        async (action) => {
          const empId = `emp-prop11-${Math.random().toString(36).slice(2)}`;
          const locId = 'loc-us';
          await balanceService.updateBalance(empId, locId, 10, UpdateSource.EMPLOYEE_REQUEST);

          const req = await torService.createRequest({
            employeeId: empId, locationId: locId,
            startDate: '2026-06-01', endDate: '2026-06-01', days: 1,
          });

          // First action
          if (action === 'approve') {
            hcmClient.getBalance.mockResolvedValue(10);
            hcmClient.setBalance.mockResolvedValue(undefined);
            await torService.approveRequest(req.id);
          } else {
            await torService.rejectRequest(req.id);
          }

          // Second action on same request should throw ConflictException
          try {
            if (action === 'approve') {
              await torService.approveRequest(req.id);
            } else {
              await torService.rejectRequest(req.id);
            }
            return false;
          } catch (err: any) {
            return err.statusCode === 409;
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});
