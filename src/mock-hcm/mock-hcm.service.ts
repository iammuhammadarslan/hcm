import { Injectable, HttpException } from '@nestjs/common';

interface ErrorInjection {
  statusCode: number;
  remaining: number;
}

@Injectable()
export class MockHcmService {
  private balances = new Map<string, number>();
  private errorInjections = new Map<string, ErrorInjection>();

  private key(employeeId: string, locationId: string): string {
    return `${employeeId}:${locationId}`;
  }

  private checkErrorInjection(employeeId: string, locationId: string): void {
    const k = this.key(employeeId, locationId);
    const injection = this.errorInjections.get(k);
    if (injection && injection.remaining > 0) {
      injection.remaining--;
      if (injection.remaining === 0) {
        this.errorInjections.delete(k);
      }
      throw new HttpException(
        { error: 'INJECTED_ERROR', message: `Simulated error ${injection.statusCode}` },
        injection.statusCode,
      );
    }
  }

  getBalance(employeeId: string, locationId: string): number {
    this.checkErrorInjection(employeeId, locationId);
    const k = this.key(employeeId, locationId);
    const balance = this.balances.get(k);
    if (balance === undefined) {
      throw new HttpException(
        { error: 'NOT_FOUND', message: `Balance not found for ${employeeId}/${locationId}` },
        404,
      );
    }
    return balance;
  }

  setBalance(employeeId: string, locationId: string, balance: number): number {
    this.checkErrorInjection(employeeId, locationId);
    if (balance < 0) {
      const current = this.balances.get(this.key(employeeId, locationId)) ?? 0;
      throw new HttpException(
        { error: 'INSUFFICIENT_BALANCE', available: current },
        422,
      );
    }
    const rounded = Math.round(balance * 100) / 100;
    this.balances.set(this.key(employeeId, locationId), rounded);
    return rounded;
  }

  simulateBalanceChange(employeeId: string, locationId: string, balance: number): void {
    if (balance < 0) {
      throw new HttpException({ error: 'NEGATIVE_BALANCE' }, 422);
    }
    this.balances.set(this.key(employeeId, locationId), Math.round(balance * 100) / 100);
  }

  injectError(employeeId: string, locationId: string, statusCode: number, times: number): void {
    this.errorInjections.set(this.key(employeeId, locationId), { statusCode, remaining: times });
  }

  reset(): void {
    this.balances.clear();
    this.errorInjections.clear();
  }

  // Expose state for test assertions
  getState() {
    return {
      balances: Object.fromEntries(this.balances),
      errorInjections: Object.fromEntries(
        Array.from(this.errorInjections.entries()).map(([k, v]) => [k, { ...v }]),
      ),
    };
  }
}
