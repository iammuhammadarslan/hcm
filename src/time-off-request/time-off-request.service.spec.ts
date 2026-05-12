import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TimeOffRequestService } from './time-off-request.service';
import { TimeOffRequest, RequestStatus, CancellationReason } from './entities/time-off-request.entity';
import { BalanceService } from '../balance/balance.service';
import { HcmClientService } from '../hcm-client/hcm-client.service';
import { Balance, UpdateSource } from '../balance/entities/balance.entity';
import { BalanceDiscrepancy } from '../balance/entities/balance-discrepancy.entity';
import {
  InsufficientBalanceException,
  ConflictException,
  NotFoundException,
  HcmClientException,
  HcmUnavailableException,
} from '../common/exceptions/app.exception';
import { testDbModule } from '../test-utils/test-db';

describe('TimeOffRequestService', () => {
  let service: TimeOffRequestService;
  let balanceService: BalanceService;
  let hcmClient: jest.Mocked<HcmClientService>;
  let module: TestingModule;

  beforeEach(async () => {
    const mockHcmClient = {
      getBalance: jest.fn(),
      setBalance: jest.fn(),
    };

    module = await Test.createTestingModule({
      imports: [
        testDbModule,
        TypeOrmModule.forFeature([Balance, BalanceDiscrepancy, TimeOffRequest]),
      ],
      providers: [
        TimeOffRequestService,
        BalanceService,
        { provide: HcmClientService, useValue: mockHcmClient },
      ],
    }).compile();

    service = module.get<TimeOffRequestService>(TimeOffRequestService);
    balanceService = module.get<BalanceService>(BalanceService);
    hcmClient = module.get(HcmClientService);
  });

  afterEach(async () => {
    await module.close();
  });

  async function seedBalance(employeeId: string, locationId: string, value: number) {
    return balanceService.updateBalance(employeeId, locationId, value, UpdateSource.EMPLOYEE_REQUEST);
  }

  describe('createRequest', () => {
    it('creates a PENDING request and reserves balance', async () => {
      await seedBalance('emp-1', 'loc-us', 10);
      const req = await service.createRequest({
        employeeId: 'emp-1', locationId: 'loc-us',
        startDate: '2026-06-01', endDate: '2026-06-03', days: 3,
      });
      expect(req.status).toBe(RequestStatus.PENDING);
      expect(Number(req.days)).toBe(3);

      const balance = await balanceService.getBalance('emp-1', 'loc-us');
      expect(Number(balance.value)).toBe(7); // 10 - 3
    });

    it('throws InsufficientBalanceException when days > balance', async () => {
      await seedBalance('emp-1', 'loc-us', 2);
      await expect(
        service.createRequest({ employeeId: 'emp-1', locationId: 'loc-us', startDate: '2026-06-01', endDate: '2026-06-05', days: 5 }),
      ).rejects.toBeInstanceOf(InsufficientBalanceException);

      // Balance should be unchanged
      const balance = await balanceService.getBalance('emp-1', 'loc-us');
      expect(Number(balance.value)).toBe(2);
    });
  });

  describe('approveRequest', () => {
    it('approves request, syncs with HCM, and performs post-write read', async () => {
      await seedBalance('emp-1', 'loc-us', 10);
      const req = await service.createRequest({
        employeeId: 'emp-1', locationId: 'loc-us',
        startDate: '2026-06-01', endDate: '2026-06-03', days: 3,
      });

      hcmClient.getBalance
        .mockResolvedValueOnce(10) // pre-approval sync
        .mockResolvedValueOnce(7); // post-write read
      hcmClient.setBalance.mockResolvedValueOnce(undefined);

      const approved = await service.approveRequest(req.id);
      expect(approved.status).toBe(RequestStatus.APPROVED);
      expect(hcmClient.setBalance).toHaveBeenCalledWith('emp-1', 'loc-us', 7);
      expect(hcmClient.getBalance).toHaveBeenCalledTimes(2);
    });

    it('rejects request when HCM balance is lower after sync', async () => {
      await seedBalance('emp-1', 'loc-us', 10);
      const req = await service.createRequest({
        employeeId: 'emp-1', locationId: 'loc-us',
        startDate: '2026-06-01', endDate: '2026-06-10', days: 8,
      });

      // HCM has only 5 days (balance was reduced independently)
      hcmClient.getBalance.mockResolvedValueOnce(5);

      await expect(service.approveRequest(req.id)).rejects.toBeInstanceOf(InsufficientBalanceException);

      // Balance should be restored to HCM value (5), not original (2 = 10-8)
      const balance = await balanceService.getBalance('emp-1', 'loc-us');
      expect(Number(balance.value)).toBe(5);
    });

    it('restores reserved balance and stays PENDING when HCM is unavailable', async () => {
      await seedBalance('emp-1', 'loc-us', 10);
      const req = await service.createRequest({
        employeeId: 'emp-1', locationId: 'loc-us',
        startDate: '2026-06-01', endDate: '2026-06-03', days: 3,
      });

      hcmClient.getBalance.mockRejectedValueOnce(
        new HcmUnavailableException('emp-1', 'loc-us', 4),
      );

      await expect(service.approveRequest(req.id)).rejects.toThrow();

      // Balance must be restored — employee is not stuck with a reserved balance
      const balance = await balanceService.getBalance('emp-1', 'loc-us');
      expect(Number(balance.value)).toBe(10);

      // Request stays PENDING so it can be retried
      const updated = await service.getRequest(req.id);
      expect(updated.status).toBe(RequestStatus.PENDING);
    });

    it('returns 422 (not 502) when HCM rejects setBalance with insufficient balance', async () => {
      await seedBalance('emp-1', 'loc-us', 10);
      const req = await service.createRequest({
        employeeId: 'emp-1', locationId: 'loc-us',
        startDate: '2026-06-01', endDate: '2026-06-03', days: 3,
      });

      const { HcmClientException } = require('../common/exceptions/app.exception');
      // HCM agrees on balance (10) but then rejects the deduction with 422
      hcmClient.getBalance.mockResolvedValueOnce(10);
      hcmClient.setBalance.mockRejectedValueOnce(
        new HcmClientException(422, 'INSUFFICIENT_BALANCE', 'emp-1', 'loc-us'),
      );

      await expect(service.approveRequest(req.id)).rejects.toBeInstanceOf(InsufficientBalanceException);

      // After setBalance fails, the reserved days (3) are restored.
      // Local balance was synced to HCM value (10) before the failure, then +3 restored = 13.
      const balance = await balanceService.getBalance('emp-1', 'loc-us');
      expect(Number(balance.value)).toBe(13);
    });

    it('throws ConflictException when request is not PENDING', async () => {
      await seedBalance('emp-1', 'loc-us', 10);
      const req = await service.createRequest({
        employeeId: 'emp-1', locationId: 'loc-us',
        startDate: '2026-06-01', endDate: '2026-06-03', days: 3,
      });

      hcmClient.getBalance.mockResolvedValue(10);
      hcmClient.setBalance.mockResolvedValue(undefined);
      await service.approveRequest(req.id);

      await expect(service.approveRequest(req.id)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('rejectRequest', () => {
    it('rejects request and restores balance', async () => {
      await seedBalance('emp-1', 'loc-us', 10);
      const req = await service.createRequest({
        employeeId: 'emp-1', locationId: 'loc-us',
        startDate: '2026-06-01', endDate: '2026-06-03', days: 3,
      });

      const rejected = await service.rejectRequest(req.id);
      expect(rejected.status).toBe(RequestStatus.REJECTED);

      const balance = await balanceService.getBalance('emp-1', 'loc-us');
      expect(Number(balance.value)).toBe(10); // restored
    });

    it('throws ConflictException for non-PENDING request', async () => {
      await seedBalance('emp-1', 'loc-us', 10);
      const req = await service.createRequest({
        employeeId: 'emp-1', locationId: 'loc-us',
        startDate: '2026-06-01', endDate: '2026-06-03', days: 3,
      });
      await service.rejectRequest(req.id);
      await expect(service.rejectRequest(req.id)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('cancelRequest', () => {
    it('cancels request and restores balance with EMPLOYEE_CANCELLED reason', async () => {
      await seedBalance('emp-1', 'loc-us', 10);
      const req = await service.createRequest({
        employeeId: 'emp-1', locationId: 'loc-us',
        startDate: '2026-06-01', endDate: '2026-06-03', days: 3,
      });

      const cancelled = await service.cancelRequest(req.id);
      expect(cancelled.status).toBe(RequestStatus.CANCELLED);
      expect(cancelled.cancellationReason).toBe(CancellationReason.EMPLOYEE_CANCELLED);

      const balance = await balanceService.getBalance('emp-1', 'loc-us');
      expect(Number(balance.value)).toBe(10);
    });

    it('throws ConflictException for APPROVED request', async () => {
      await seedBalance('emp-1', 'loc-us', 10);
      const req = await service.createRequest({
        employeeId: 'emp-1', locationId: 'loc-us',
        startDate: '2026-06-01', endDate: '2026-06-03', days: 3,
      });
      hcmClient.getBalance.mockResolvedValue(10);
      hcmClient.setBalance.mockResolvedValue(undefined);
      await service.approveRequest(req.id);

      await expect(service.cancelRequest(req.id)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('listRequests', () => {
    it('returns requests ordered by submittedAt descending', async () => {
      await seedBalance('emp-1', 'loc-us', 20);
      await service.createRequest({ employeeId: 'emp-1', locationId: 'loc-us', startDate: '2026-06-01', endDate: '2026-06-01', days: 1 });
      await service.createRequest({ employeeId: 'emp-1', locationId: 'loc-us', startDate: '2026-06-02', endDate: '2026-06-02', days: 1 });

      const requests = await service.listRequests('emp-1');
      expect(requests).toHaveLength(2);
      expect(new Date(requests[0].submittedAt) >= new Date(requests[1].submittedAt)).toBe(true);
    });

    it('only returns requests for the specified employee', async () => {
      await seedBalance('emp-1', 'loc-us', 10);
      await seedBalance('emp-2', 'loc-us', 10);
      await service.createRequest({ employeeId: 'emp-1', locationId: 'loc-us', startDate: '2026-06-01', endDate: '2026-06-01', days: 1 });
      await service.createRequest({ employeeId: 'emp-2', locationId: 'loc-us', startDate: '2026-06-01', endDate: '2026-06-01', days: 1 });

      const requests = await service.listRequests('emp-1');
      expect(requests).toHaveLength(1);
      expect(requests[0].employeeId).toBe('emp-1');
    });
  });

  describe('reEvaluatePendingRequests', () => {
    it('cancels pending requests that exceed new balance', async () => {
      await seedBalance('emp-1', 'loc-us', 10);
      const req1 = await service.createRequest({ employeeId: 'emp-1', locationId: 'loc-us', startDate: '2026-06-01', endDate: '2026-06-05', days: 5 });
      const req2 = await service.createRequest({ employeeId: 'emp-1', locationId: 'loc-us', startDate: '2026-06-06', endDate: '2026-06-08', days: 3 });

      // Simulate HCM reducing balance to 2 (both requests now exceed it)
      await balanceService.updateBalance('emp-1', 'loc-us', 2, UpdateSource.HCM_BATCH);

      const cancelled = await service.reEvaluatePendingRequests('emp-1', 'loc-us');
      expect(cancelled).toBe(2);

      const r1 = await service.getRequest(req1.id);
      const r2 = await service.getRequest(req2.id);
      expect(r1.status).toBe(RequestStatus.CANCELLED);
      expect(r2.status).toBe(RequestStatus.CANCELLED);
      expect(r1.cancellationReason).toBe(CancellationReason.BALANCE_UPDATED_BY_HCM);
    });
  });

  describe('getRequest', () => {
    it('throws NotFoundException for unknown id', async () => {
      await expect(service.getRequest('nonexistent-id')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
