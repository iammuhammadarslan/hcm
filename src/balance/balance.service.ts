import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual, LessThanOrEqual, FindOptionsWhere } from 'typeorm';
import { Balance, UpdateSource } from './entities/balance.entity';
import {
  BalanceDiscrepancy,
  DetectedDuring,
  ResolutionAction,
} from './entities/balance-discrepancy.entity';
import {
  NegativeBalanceException,
  NotFoundException,
} from '../common/exceptions/app.exception';

const TOLERANCE = 0.01;

@Injectable()
export class BalanceService {
  private readonly logger = new Logger(BalanceService.name);

  constructor(
    @InjectRepository(Balance)
    private readonly balanceRepo: Repository<Balance>,
    @InjectRepository(BalanceDiscrepancy)
    private readonly discrepancyRepo: Repository<BalanceDiscrepancy>,
  ) {}

  async getOrCreate(employeeId: string, locationId: string, initialValue = 0): Promise<Balance> {
    let balance = await this.balanceRepo.findOne({ where: { employeeId, locationId } });
    if (!balance) {
      balance = this.balanceRepo.create({
        employeeId,
        locationId,
        value: initialValue,
        lastUpdateSource: UpdateSource.EMPLOYEE_REQUEST,
      });
      await this.balanceRepo.save(balance);
    }
    return balance;
  }

  async getBalance(employeeId: string, locationId: string): Promise<Balance> {
    const balance = await this.balanceRepo.findOne({ where: { employeeId, locationId } });
    if (!balance) {
      throw new NotFoundException('Balance', `${employeeId}/${locationId}`);
    }
    return balance;
  }

  async reserveBalance(employeeId: string, locationId: string, days: number): Promise<Balance> {
    const balance = await this.getBalance(employeeId, locationId);
    const newValue = Number(balance.value) - days;
    if (newValue < 0) {
      throw new NegativeBalanceException(newValue);
    }
    balance.value = Math.round(newValue * 100) / 100;
    balance.lastUpdateSource = UpdateSource.EMPLOYEE_REQUEST;
    return this.balanceRepo.save(balance);
  }

  async restoreBalance(employeeId: string, locationId: string, days: number): Promise<Balance> {
    const balance = await this.getBalance(employeeId, locationId);
    balance.value = Math.round((Number(balance.value) + days) * 100) / 100;
    balance.lastUpdateSource = UpdateSource.EMPLOYEE_REQUEST;
    return this.balanceRepo.save(balance);
  }

  async updateBalance(
    employeeId: string,
    locationId: string,
    value: number,
    source: UpdateSource,
  ): Promise<Balance> {
    if (value < 0) {
      throw new NegativeBalanceException(value);
    }
    let balance = await this.balanceRepo.findOne({ where: { employeeId, locationId } });
    if (!balance) {
      balance = this.balanceRepo.create({ employeeId, locationId });
    }
    balance.value = Math.round(value * 100) / 100;
    balance.lastUpdateSource = source;
    return this.balanceRepo.save(balance);
  }

  isDifferent(a: number, b: number): boolean {
    return Math.abs(Number(a) - Number(b)) > TOLERANCE;
  }

  async syncIfDifferent(
    employeeId: string,
    locationId: string,
    hcmValue: number,
    source: UpdateSource,
    detectedDuring: DetectedDuring,
  ): Promise<{ updated: boolean; balance: Balance }> {
    const balance = await this.getBalance(employeeId, locationId);
    if (this.isDifferent(balance.value, hcmValue)) {
      this.logger.warn(
        `Balance discrepancy for ${employeeId}/${locationId}: local=${balance.value} hcm=${hcmValue} during=${detectedDuring}`,
      );
      await this.recordDiscrepancy({
        employeeId,
        locationId,
        localValue: Number(balance.value),
        hcmValue,
        resolutionAction: ResolutionAction.LOCAL_UPDATED_TO_HCM,
        detectedDuring,
      });
      const updated = await this.updateBalance(employeeId, locationId, hcmValue, source);
      return { updated: true, balance: updated };
    }
    return { updated: false, balance };
  }

  async recordDiscrepancy(event: {
    employeeId: string;
    locationId: string;
    localValue: number;
    hcmValue: number;
    resolutionAction: ResolutionAction;
    detectedDuring: DetectedDuring;
  }): Promise<BalanceDiscrepancy> {
    const discrepancy = this.discrepancyRepo.create(event);
    return this.discrepancyRepo.save(discrepancy);
  }

  async getDiscrepancies(filter: {
    employeeId?: string;
    locationId?: string;
    from?: string;
    to?: string;
  }): Promise<BalanceDiscrepancy[]> {
    const where: FindOptionsWhere<BalanceDiscrepancy> = {};
    if (filter.employeeId) where.employeeId = filter.employeeId;
    if (filter.locationId) where.locationId = filter.locationId;
    if (filter.from && filter.to) {
      where.detectedAt = Between(new Date(filter.from), new Date(filter.to));
    } else if (filter.from) {
      where.detectedAt = MoreThanOrEqual(new Date(filter.from));
    } else if (filter.to) {
      where.detectedAt = LessThanOrEqual(new Date(filter.to));
    }
    return this.discrepancyRepo.find({ where, order: { detectedAt: 'DESC' } });
  }

  async getRecentlyUpdatedDimensions(sinceHours = 24): Promise<Array<{ employeeId: string; locationId: string }>> {
    const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
    return this.balanceRepo
      .createQueryBuilder('b')
      .select(['b.employeeId', 'b.locationId'])
      .where('b.updatedAt >= :since', { since })
      .getMany();
  }
}
