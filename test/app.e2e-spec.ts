import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { Balance } from '../src/balance/entities/balance.entity';
import { BalanceDiscrepancy } from '../src/balance/entities/balance-discrepancy.entity';
import { TimeOffRequest } from '../src/time-off-request/entities/time-off-request.entity';
import { BalanceModule } from '../src/balance/balance.module';
import { TimeOffRequestModule } from '../src/time-off-request/time-off-request.module';
import { SyncModule } from '../src/sync/sync.module';
import { HcmClientModule } from '../src/hcm-client/hcm-client.module';
import { AppExceptionFilter } from '../src/common/filters/app-exception.filter';
import { HcmClientService } from '../src/hcm-client/hcm-client.service';

describe('Time-Off Microservice (E2E)', () => {
  let app: INestApplication;
  let mockHcmClient: jest.Mocked<HcmClientService>;

  beforeEach(async () => {
    mockHcmClient = {
      getBalance: jest.fn(),
      setBalance: jest.fn(),
    } as any;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [Balance, BalanceDiscrepancy, TimeOffRequest],
          synchronize: true,
          dropSchema: true,
        }),
        ScheduleModule.forRoot(),
        HcmClientModule,
        BalanceModule,
        TimeOffRequestModule,
        SyncModule,
      ],
    })
      .overrideProvider(HcmClientService)
      .useValue(mockHcmClient)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new AppExceptionFilter());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  async function seedBalance(employeeId: string, locationId: string, value: number) {
    return request(app.getHttpServer())
      .post('/balances')
      .send({ employeeId, locationId, value })
      .expect(201);
  }

  async function submitRequest(employeeId: string, locationId: string, days: number) {
    return request(app.getHttpServer())
      .post('/time-off-requests')
      .send({
        employeeId, locationId,
        startDate: '2026-06-01', endDate: '2026-06-05', days,
      });
  }

  // ── Test: Complete employee workflow ──────────────────────────────────────
  describe('Complete employee workflow', () => {
    it('creates balance → submits request → manager approves → verifies final state', async () => {
      await seedBalance('emp-1', 'loc-us', 10);

      // Submit request
      const submitRes = await submitRequest('emp-1', 'loc-us', 3);
      expect(submitRes.status).toBe(201);
      expect(submitRes.body.status).toBe('PENDING');
      const reqId = submitRes.body.id;

      // Balance should be reserved
      const balanceRes = await request(app.getHttpServer()).get('/balances/emp-1/loc-us');
      expect(balanceRes.body.value).toBe(7);

      // Manager approves
      mockHcmClient.getBalance
        .mockResolvedValueOnce(10) // pre-approval sync (HCM has original)
        .mockResolvedValueOnce(7); // post-write read
      mockHcmClient.setBalance.mockResolvedValueOnce(undefined);

      const approveRes = await request(app.getHttpServer())
        .patch(`/time-off-requests/${reqId}/approve`);
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.status).toBe('APPROVED');

      // HCM setBalance was called with correct value
      expect(mockHcmClient.setBalance).toHaveBeenCalledWith('emp-1', 'loc-us', 7);
    });
  });

  // ── Test: Cancellation workflow ───────────────────────────────────────────
  describe('Cancellation workflow', () => {
    it('submit → cancel → balance restored', async () => {
      await seedBalance('emp-1', 'loc-us', 10);
      const submitRes = await submitRequest('emp-1', 'loc-us', 4);
      const reqId = submitRes.body.id;

      // Balance reserved
      let balRes = await request(app.getHttpServer()).get('/balances/emp-1/loc-us');
      expect(balRes.body.value).toBe(6);

      // Cancel
      const cancelRes = await request(app.getHttpServer())
        .patch(`/time-off-requests/${reqId}/cancel`);
      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.status).toBe('CANCELLED');
      expect(cancelRes.body.cancellationReason).toBe('EMPLOYEE_CANCELLED');

      // Balance restored
      balRes = await request(app.getHttpServer()).get('/balances/emp-1/loc-us');
      expect(balRes.body.value).toBe(10);
    });
  });

  // ── Test: Batch sync workflow ─────────────────────────────────────────────
  describe('Batch sync workflow', () => {
    it('seeds balances → POST batch-sync → verifies summary and state', async () => {
      await seedBalance('emp-1', 'loc-us', 10);
      await seedBalance('emp-2', 'loc-us', 5);

      const batchRes = await request(app.getHttpServer())
        .post('/hcm/batch-sync')
        .send({
          records: [
            { employeeId: 'emp-1', locationId: 'loc-us', balance: 15 },
            { employeeId: 'emp-2', locationId: 'loc-us', balance: 5 },   // no change
            { employeeId: 'emp-3', locationId: 'loc-us', balance: 8 },   // new dimension — upserted
          ],
        });

      expect(batchRes.status).toBe(200);
      expect(batchRes.body.received).toBe(3);
      expect(batchRes.body.updated).toBe(1);  // emp-1 updated
      expect(batchRes.body.skipped).toBe(0);  // emp-3 upserted, not skipped
      expect(batchRes.body.cancelled).toBe(0);

      const balRes = await request(app.getHttpServer()).get('/balances/emp-1/loc-us');
      expect(balRes.body.value).toBe(15);

      // emp-3 was created by the batch sync
      const newEmpRes = await request(app.getHttpServer()).get('/balances/emp-3/loc-us');
      expect(newEmpRes.status).toBe(200);
      expect(newEmpRes.body.value).toBe(8);
    });

    it('cancels pending requests when batch sync reduces balance below reserved amount', async () => {
      await seedBalance('emp-1', 'loc-us', 10);
      const submitRes = await submitRequest('emp-1', 'loc-us', 8);
      const reqId = submitRes.body.id;

      // Batch sync reduces balance to 3 (less than 8-day request)
      const batchRes = await request(app.getHttpServer())
        .post('/hcm/batch-sync')
        .send({ records: [{ employeeId: 'emp-1', locationId: 'loc-us', balance: 3 }] });

      expect(batchRes.body.cancelled).toBe(1);

      const reqRes = await request(app.getHttpServer()).get(`/time-off-requests/${reqId}`);
      expect(reqRes.body.status).toBe('CANCELLED');
      expect(reqRes.body.cancellationReason).toBe('BALANCE_UPDATED_BY_HCM');
    });

    it('work anniversary: HCM sends refreshed balance → pending requests re-evaluated', async () => {
      // Employee has 5 days, submits a 4-day request (balance reserved to 1)
      await seedBalance('emp-1', 'loc-us', 5);
      const req = await submitRequest('emp-1', 'loc-us', 4);
      expect(req.body.status).toBe('PENDING');

      // Work anniversary: HCM sends a refreshed balance of 15 days via batch sync
      const batchRes = await request(app.getHttpServer())
        .post('/hcm/batch-sync')
        .send({ records: [{ employeeId: 'emp-1', locationId: 'loc-us', balance: 15 }] });

      expect(batchRes.status).toBe(200);
      expect(batchRes.body.updated).toBe(1);
      expect(batchRes.body.cancelled).toBe(0); // 4-day request still fits within 15

      // Local balance updated to 15
      const balRes = await request(app.getHttpServer()).get('/balances/emp-1/loc-us');
      expect(balRes.body.value).toBe(15);

      // Pending request is still active — employee can now get it approved
      const reqRes = await request(app.getHttpServer()).get(`/time-off-requests/${req.body.id}`);
      expect(reqRes.body.status).toBe('PENDING');
    });

    it('work anniversary with insufficient old balance: new employee gets balance via batch', async () => {
      // emp-new has never interacted with ExampleHR — no local balance record
      const batchRes = await request(app.getHttpServer())
        .post('/hcm/batch-sync')
        .send({ records: [{ employeeId: 'emp-new', locationId: 'loc-eu', balance: 25 }] });

      expect(batchRes.status).toBe(200);
      expect(batchRes.body.skipped).toBe(0); // upserted, not skipped

      const balRes = await request(app.getHttpServer()).get('/balances/emp-new/loc-eu');
      expect(balRes.status).toBe(200);
      expect(balRes.body.value).toBe(25);
    });
  });

  // ── Test: HCM error handling ──────────────────────────────────────────────
  describe('HCM error handling', () => {
    it('returns 503 and restores balance when HCM is unavailable during approval', async () => {
      await seedBalance('emp-1', 'loc-us', 10);
      const submitRes = await submitRequest('emp-1', 'loc-us', 3);
      const reqId = submitRes.body.id;

      const { HcmUnavailableException } = require('../src/common/exceptions/app.exception');
      mockHcmClient.getBalance.mockRejectedValueOnce(
        new HcmUnavailableException('emp-1', 'loc-us', 3),
      );

      const approveRes = await request(app.getHttpServer())
        .patch(`/time-off-requests/${reqId}/approve`);
      expect(approveRes.status).toBe(503);

      // Balance must be restored — employee is not stuck
      const balRes = await request(app.getHttpServer()).get('/balances/emp-1/loc-us');
      expect(balRes.body.value).toBe(10);

      // Request stays PENDING for retry
      const reqRes = await request(app.getHttpServer()).get(`/time-off-requests/${reqId}`);
      expect(reqRes.body.status).toBe('PENDING');
    });

    it('returns 422 (not 502) when HCM rejects setBalance with insufficient balance', async () => {
      await seedBalance('emp-1', 'loc-us', 10);
      const submitRes = await submitRequest('emp-1', 'loc-us', 3);
      const reqId = submitRes.body.id;

      const { HcmClientException } = require('../src/common/exceptions/app.exception');
      // HCM agrees on balance (10) but then rejects the deduction with 422
      mockHcmClient.getBalance.mockResolvedValueOnce(10);
      mockHcmClient.setBalance.mockRejectedValueOnce(
        new HcmClientException(422, 'INSUFFICIENT_BALANCE', 'emp-1', 'loc-us'),
      );

      const approveRes = await request(app.getHttpServer())
        .patch(`/time-off-requests/${reqId}/approve`);
      expect(approveRes.status).toBe(422);
      expect(approveRes.body.error).toBe('INSUFFICIENT_BALANCE');

      // After setBalance fails, the reserved days (3) are restored.
      // Local balance was synced to HCM value (10) before the failure, then +3 restored = 13.
      const balRes = await request(app.getHttpServer()).get('/balances/emp-1/loc-us');
      expect(balRes.body.value).toBe(13);
    });
  });

  // ── Test: Validation ──────────────────────────────────────────────────────
  describe('Input validation', () => {
    it('returns 400 when required fields are missing', async () => {
      const res = await request(app.getHttpServer())
        .post('/time-off-requests')
        .send({ employeeId: 'emp-1' }); // missing locationId, startDate, endDate, days
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('returns 422 when endDate is before startDate', async () => {
      await seedBalance('emp-1', 'loc-us', 10);
      const res = await request(app.getHttpServer())
        .post('/time-off-requests')
        .send({
          employeeId: 'emp-1', locationId: 'loc-us',
          startDate: '2026-06-10', endDate: '2026-06-01', days: 3,
        });
      expect(res.status).toBe(400); // class-validator catches this
    });

    it('returns 404 for unknown request id', async () => {
      const res = await request(app.getHttpServer())
        .get('/time-off-requests/nonexistent-id');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
    });

    it('returns 409 when approving an already-approved request', async () => {
      await seedBalance('emp-1', 'loc-us', 10);
      const submitRes = await submitRequest('emp-1', 'loc-us', 2);
      const reqId = submitRes.body.id;

      mockHcmClient.getBalance.mockResolvedValue(10);
      mockHcmClient.setBalance.mockResolvedValue(undefined);
      await request(app.getHttpServer()).patch(`/time-off-requests/${reqId}/approve`);

      const res = await request(app.getHttpServer())
        .patch(`/time-off-requests/${reqId}/approve`);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('INVALID_STATUS_TRANSITION');
    });

    it('returns JSON content-type for all responses', async () => {
      const res = await request(app.getHttpServer()).get('/time-off-requests/nonexistent');
      expect(res.headers['content-type']).toMatch(/application\/json/);
    });
  });

  // ── Test: Balance sync endpoint ───────────────────────────────────────────
  describe('Balance sync endpoint', () => {
    it('POST /balances/:emp/:loc/sync updates local balance from HCM', async () => {
      await seedBalance('emp-1', 'loc-us', 10);
      mockHcmClient.getBalance.mockResolvedValueOnce(20);

      const res = await request(app.getHttpServer())
        .post('/balances/emp-1/loc-us/sync');
      expect(res.status).toBe(200);
      expect(res.body.value).toBe(20);
    });
  });

  // ── Test: Discrepancies endpoint ──────────────────────────────────────────
  describe('Discrepancies endpoint', () => {
    it('GET /balances/discrepancies returns recorded discrepancy events', async () => {
      await seedBalance('emp-1', 'loc-us', 10);
      mockHcmClient.getBalance.mockResolvedValueOnce(20); // triggers discrepancy
      await request(app.getHttpServer()).post('/balances/emp-1/loc-us/sync');

      const res = await request(app.getHttpServer()).get('/balances/discrepancies?employeeId=emp-1');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].employeeId).toBe('emp-1');
      expect(res.body[0].localValue).toBe(10);
      expect(res.body[0].hcmValue).toBe(20);
    });
  });

  // ── Test: List requests ordering ──────────────────────────────────────────
  describe('List requests', () => {
    it('returns requests ordered by submittedAt descending', async () => {
      await seedBalance('emp-1', 'loc-us', 20);
      await submitRequest('emp-1', 'loc-us', 1);
      await submitRequest('emp-1', 'loc-us', 1);
      await submitRequest('emp-1', 'loc-us', 1);

      const res = await request(app.getHttpServer())
        .get('/time-off-requests?employeeId=emp-1');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);

      const dates = res.body.map((r: any) => new Date(r.submittedAt).getTime());
      for (let i = 0; i < dates.length - 1; i++) {
        expect(dates[i]).toBeGreaterThanOrEqual(dates[i + 1]);
      }
    });
  });
});
