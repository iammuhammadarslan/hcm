import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BalanceService } from './balance.service';
import { Balance, UpdateSource } from './entities/balance.entity';
import { BalanceDiscrepancy, DetectedDuring, ResolutionAction } from './entities/balance-discrepancy.entity';
import { NegativeBalanceException, NotFoundException } from '../common/exceptions/app.exception';
import { testDbModule } from '../test-utils/test-db';

describe('BalanceService', () => {
  let service: BalanceService;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        testDbModule,
        TypeOrmModule.forFeature([Balance, BalanceDiscrepancy]),
      ],
      providers: [BalanceService],
    }).compile();

    service = module.get<BalanceService>(BalanceService);
  });

  afterEach(async () => {
    await module.close();
  });

  describe('getOrCreate', () => {
    it('creates a new balance with initial value', async () => {
      const balance = await service.getOrCreate('emp-1', 'loc-us', 10);
      expect(balance.employeeId).toBe('emp-1');
      expect(balance.locationId).toBe('loc-us');
      expect(Number(balance.value)).toBe(10);
    });

    it('returns existing balance without overwriting', async () => {
      await service.getOrCreate('emp-1', 'loc-us', 10);
      const second = await service.getOrCreate('emp-1', 'loc-us', 99);
      expect(Number(second.value)).toBe(10);
    });
  });

  describe('getBalance', () => {
    it('throws NotFoundException for unknown dimension', async () => {
      await expect(service.getBalance('unknown', 'loc-us')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('reserveBalance', () => {
    it('deducts days from balance', async () => {
      await service.getOrCreate('emp-1', 'loc-us', 10);
      const result = await service.reserveBalance('emp-1', 'loc-us', 3);
      expect(Number(result.value)).toBe(7);
    });

    it('throws NegativeBalanceException when deduction exceeds balance', async () => {
      await service.getOrCreate('emp-1', 'loc-us', 2);
      await expect(service.reserveBalance('emp-1', 'loc-us', 5)).rejects.toBeInstanceOf(NegativeBalanceException);
    });

    it('allows exact deduction to zero', async () => {
      await service.getOrCreate('emp-1', 'loc-us', 5);
      const result = await service.reserveBalance('emp-1', 'loc-us', 5);
      expect(Number(result.value)).toBe(0);
    });
  });

  describe('restoreBalance', () => {
    it('adds days back to balance', async () => {
      await service.getOrCreate('emp-1', 'loc-us', 7);
      const result = await service.restoreBalance('emp-1', 'loc-us', 3);
      expect(Number(result.value)).toBe(10);
    });
  });

  describe('updateBalance', () => {
    it('sets balance to exact value with correct source', async () => {
      await service.getOrCreate('emp-1', 'loc-us', 5);
      const result = await service.updateBalance('emp-1', 'loc-us', 15, UpdateSource.HCM_BATCH);
      expect(Number(result.value)).toBe(15);
      expect(result.lastUpdateSource).toBe(UpdateSource.HCM_BATCH);
    });

    it('throws NegativeBalanceException for negative value', async () => {
      await service.getOrCreate('emp-1', 'loc-us', 5);
      await expect(service.updateBalance('emp-1', 'loc-us', -1, UpdateSource.HCM_BATCH))
        .rejects.toBeInstanceOf(NegativeBalanceException);
    });

    it('creates balance record if it does not exist', async () => {
      const result = await service.updateBalance('new-emp', 'loc-us', 20, UpdateSource.HCM_BATCH);
      expect(Number(result.value)).toBe(20);
    });
  });

  describe('isDifferent', () => {
    it('returns false when values are within tolerance', () => {
      expect(service.isDifferent(10.0, 10.005)).toBe(false);
    });

    it('returns true when values exceed tolerance', () => {
      expect(service.isDifferent(10.0, 10.02)).toBe(true);
    });
  });

  describe('syncIfDifferent', () => {
    it('updates balance and records discrepancy when values differ', async () => {
      await service.getOrCreate('emp-1', 'loc-us', 10);
      const { updated, balance } = await service.syncIfDifferent(
        'emp-1', 'loc-us', 15, UpdateSource.HCM_REALTIME, DetectedDuring.REALTIME_SYNC,
      );
      expect(updated).toBe(true);
      expect(Number(balance.value)).toBe(15);

      const discrepancies = await service.getDiscrepancies({ employeeId: 'emp-1' });
      expect(discrepancies).toHaveLength(1);
      expect(discrepancies[0].resolutionAction).toBe(ResolutionAction.LOCAL_UPDATED_TO_HCM);
      expect(discrepancies[0].detectedDuring).toBe(DetectedDuring.REALTIME_SYNC);
    });

    it('does not update when values are within tolerance', async () => {
      await service.getOrCreate('emp-1', 'loc-us', 10);
      const { updated } = await service.syncIfDifferent(
        'emp-1', 'loc-us', 10.005, UpdateSource.HCM_REALTIME, DetectedDuring.REALTIME_SYNC,
      );
      expect(updated).toBe(false);
    });
  });

  describe('recordDiscrepancy', () => {
    it('persists all required fields', async () => {
      const event = {
        employeeId: 'emp-1',
        locationId: 'loc-us',
        localValue: 10,
        hcmValue: 12,
        resolutionAction: ResolutionAction.LOCAL_UPDATED_TO_HCM,
        detectedDuring: DetectedDuring.BATCH_SYNC,
      };
      const result = await service.recordDiscrepancy(event);
      expect(result.id).toBeDefined();
      expect(result.employeeId).toBe('emp-1');
      expect(result.locationId).toBe('loc-us');
      expect(Number(result.localValue)).toBe(10);
      expect(Number(result.hcmValue)).toBe(12);
      expect(result.resolutionAction).toBe(ResolutionAction.LOCAL_UPDATED_TO_HCM);
      expect(result.detectedDuring).toBe(DetectedDuring.BATCH_SYNC);
      expect(result.detectedAt).toBeDefined();
    });
  });

  describe('getDiscrepancies', () => {
    it('filters by employeeId', async () => {
      await service.getOrCreate('emp-1', 'loc-us', 10);
      await service.getOrCreate('emp-2', 'loc-us', 10);
      await service.syncIfDifferent('emp-1', 'loc-us', 15, UpdateSource.HCM_BATCH, DetectedDuring.BATCH_SYNC);
      await service.syncIfDifferent('emp-2', 'loc-us', 20, UpdateSource.HCM_BATCH, DetectedDuring.BATCH_SYNC);

      const results = await service.getDiscrepancies({ employeeId: 'emp-1' });
      expect(results).toHaveLength(1);
      expect(results[0].employeeId).toBe('emp-1');
    });
  });
});
