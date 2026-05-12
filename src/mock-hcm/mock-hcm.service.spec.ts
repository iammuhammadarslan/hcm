import { MockHcmService } from './mock-hcm.service';
import { HttpException } from '@nestjs/common';

describe('MockHcmService', () => {
  let service: MockHcmService;

  beforeEach(() => {
    service = new MockHcmService();
  });

  describe('getBalance', () => {
    it('throws 404 for unknown dimension', () => {
      expect(() => service.getBalance('emp-1', 'loc-us')).toThrow(HttpException);
    });

    it('returns balance after it is set', () => {
      service.setBalance('emp-1', 'loc-us', 10);
      expect(service.getBalance('emp-1', 'loc-us')).toBe(10);
    });
  });

  describe('setBalance', () => {
    it('stores and returns rounded balance', () => {
      const result = service.setBalance('emp-1', 'loc-us', 10.555);
      expect(result).toBe(10.56);
    });

    it('throws 422 for negative balance', () => {
      service.setBalance('emp-1', 'loc-us', 5);
      expect(() => service.setBalance('emp-1', 'loc-us', -1)).toThrow(HttpException);
    });
  });

  describe('simulateBalanceChange', () => {
    it('sets balance directly without validation against current', () => {
      service.simulateBalanceChange('emp-1', 'loc-us', 99);
      expect(service.getBalance('emp-1', 'loc-us')).toBe(99);
    });

    it('throws 422 for negative value', () => {
      expect(() => service.simulateBalanceChange('emp-1', 'loc-us', -1)).toThrow(HttpException);
    });
  });

  describe('error injection', () => {
    it('returns injected error for configured number of requests', () => {
      service.setBalance('emp-1', 'loc-us', 10);
      service.injectError('emp-1', 'loc-us', 503, 2);

      expect(() => service.getBalance('emp-1', 'loc-us')).toThrow(HttpException);
      expect(() => service.getBalance('emp-1', 'loc-us')).toThrow(HttpException);
      // Third request should succeed
      expect(service.getBalance('emp-1', 'loc-us')).toBe(10);
    });
  });

  describe('reset', () => {
    it('clears all state', () => {
      service.setBalance('emp-1', 'loc-us', 10);
      service.injectError('emp-1', 'loc-us', 503, 1);
      service.reset();

      expect(() => service.getBalance('emp-1', 'loc-us')).toThrow(HttpException);
      const state = service.getState();
      expect(Object.keys(state.balances)).toHaveLength(0);
      expect(Object.keys(state.errorInjections)).toHaveLength(0);
    });
  });

  // Property 6: HCM Balance Round-Trip
  it('Property 6: write then read returns same value within tolerance', () => {
    const values = [0, 0.01, 1.5, 10, 99.99, 100];
    for (const v of values) {
      service.reset();
      service.setBalance('emp-1', 'loc-us', v);
      const read = service.getBalance('emp-1', 'loc-us');
      expect(Math.abs(read - v)).toBeLessThanOrEqual(0.01);
    }
  });
});
