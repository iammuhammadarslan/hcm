import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TimeOffRequest,
  RequestStatus,
  CancellationReason,
} from './entities/time-off-request.entity';
import { CreateTimeOffRequestDto } from './dto/create-time-off-request.dto';
import { BalanceService } from '../balance/balance.service';
import { HcmClientService } from '../hcm-client/hcm-client.service';
import { UpdateSource } from '../balance/entities/balance.entity';
import { DetectedDuring } from '../balance/entities/balance-discrepancy.entity';
import {
  NotFoundException,
  ConflictException,
  InsufficientBalanceException,
  HcmClientException,
} from '../common/exceptions/app.exception';

@Injectable()
export class TimeOffRequestService {
  private readonly logger = new Logger(TimeOffRequestService.name);

  constructor(
    @InjectRepository(TimeOffRequest)
    private readonly requestRepo: Repository<TimeOffRequest>,
    private readonly balanceService: BalanceService,
    private readonly hcmClient: HcmClientService,
  ) {}

  async createRequest(dto: CreateTimeOffRequestDto): Promise<TimeOffRequest> {
    const balance = await this.balanceService.getBalance(dto.employeeId, dto.locationId);
    const available = Number(balance.value);
    if (dto.days > available) {
      throw new InsufficientBalanceException(available, dto.days);
    }

    await this.balanceService.reserveBalance(dto.employeeId, dto.locationId, dto.days);

    const request = this.requestRepo.create({
      employeeId: dto.employeeId,
      locationId: dto.locationId,
      startDate: dto.startDate,
      endDate: dto.endDate,
      days: dto.days,
      status: RequestStatus.PENDING,
    });
    return this.requestRepo.save(request);
  }

  async listRequests(employeeId: string): Promise<TimeOffRequest[]> {
    return this.requestRepo.find({
      where: { employeeId },
      order: { submittedAt: 'DESC' },
    });
  }

  async getRequest(id: string): Promise<TimeOffRequest> {
    const request = await this.requestRepo.findOne({ where: { id } });
    if (!request) throw new NotFoundException('TimeOffRequest', id);
    return request;
  }

  async approveRequest(id: string): Promise<TimeOffRequest> {
    const request = await this.getRequest(id);
    if (request.status !== RequestStatus.PENDING) {
      throw new ConflictException(request.status, 'approve');
    }

    // 1. Real-time HCM sync before approval — may throw if HCM is unavailable.
    //    Any exception here restores the reserved balance so the employee is not stuck.
    let hcmBalance: number;
    try {
      hcmBalance = await this.hcmClient.getBalance(request.employeeId, request.locationId);
    } catch (err) {
      await this.balanceService.restoreBalance(
        request.employeeId,
        request.locationId,
        Number(request.days),
      );
      throw err;
    }

    await this.balanceService.syncIfDifferent(
      request.employeeId,
      request.locationId,
      hcmBalance,
      UpdateSource.HCM_REALTIME,
      DetectedDuring.REALTIME_SYNC,
    );

    // 2. Re-evaluate after sync — HCM is authoritative.
    // The balance was already reserved when the request was created (days deducted).
    // If the HCM balance (before our deduction) is less than request.days, reject.
    if (hcmBalance < Number(request.days)) {
      // Sync local balance to the authoritative HCM value and surface a clear 422.
      await this.balanceService.updateBalance(
        request.employeeId,
        request.locationId,
        hcmBalance,
        UpdateSource.HCM_REALTIME,
      );
      throw new InsufficientBalanceException(hcmBalance, Number(request.days));
    }

    // 3. Submit deduction to HCM.
    // HCM may return 422 INSUFFICIENT_BALANCE — translateHcmError() converts it to
    // InsufficientBalanceException so the caller gets a meaningful 422, not a 502.
    // Any exception here restores the reserved balance.
    const newHcmBalance = Number(hcmBalance) - Number(request.days);
    try {
      await this.hcmClient.setBalance(request.employeeId, request.locationId, newHcmBalance);
    } catch (err) {
      await this.balanceService.restoreBalance(
        request.employeeId,
        request.locationId,
        Number(request.days),
      );
      throw this.translateHcmError(err);
    }

    // 4. Post-write read (defensive)
    const confirmedBalance = await this.hcmClient.getBalance(request.employeeId, request.locationId);
    await this.balanceService.syncIfDifferent(
      request.employeeId,
      request.locationId,
      confirmedBalance,
      UpdateSource.HCM_REALTIME,
      DetectedDuring.POST_WRITE_READ,
    );

    if (Math.abs(confirmedBalance - newHcmBalance) > 0.01) {
      this.logger.warn(
        `Post-write read discrepancy for ${request.employeeId}/${request.locationId}: ` +
        `expected=${newHcmBalance} confirmed=${confirmedBalance}`,
      );
    }

    request.status = RequestStatus.APPROVED;
    return this.requestRepo.save(request);
  }

  /**
   * Converts a HcmClientException with status 422 into an InsufficientBalanceException
   * so the API surface returns 422 instead of 502 when HCM rejects the deduction.
   * All other errors are re-thrown unchanged.
   */
  private translateHcmError(err: unknown): unknown {
    if (
      err instanceof HcmClientException &&
      (err as any).details?.hcmStatusCode === 422
    ) {
      return new InsufficientBalanceException(0, 0);
    }
    return err;
  }

  async rejectRequest(id: string): Promise<TimeOffRequest> {
    const request = await this.getRequest(id);
    if (request.status !== RequestStatus.PENDING) {
      throw new ConflictException(request.status, 'reject');
    }
    await this.balanceService.restoreBalance(request.employeeId, request.locationId, Number(request.days));
    request.status = RequestStatus.REJECTED;
    return this.requestRepo.save(request);
  }

  async cancelRequest(id: string): Promise<TimeOffRequest> {
    const request = await this.getRequest(id);
    if (request.status !== RequestStatus.PENDING) {
      throw new ConflictException(request.status, 'cancel');
    }
    await this.balanceService.restoreBalance(request.employeeId, request.locationId, Number(request.days));
    request.status = RequestStatus.CANCELLED;
    request.cancellationReason = CancellationReason.EMPLOYEE_CANCELLED;
    return this.requestRepo.save(request);
  }

  async reEvaluatePendingRequests(
    employeeId: string,
    locationId: string,
  ): Promise<number> {
    const pending = await this.requestRepo.find({
      where: { employeeId, locationId, status: RequestStatus.PENDING },
      order: { submittedAt: 'ASC' },
    });

    const balance = await this.balanceService.getBalance(employeeId, locationId);
    // Compare each pending request against the authoritative HCM balance.
    // Any request whose days exceed the new balance is cancelled and its
    // reserved days are restored. We use the fixed HCM value for all comparisons
    // (not a running total) because HCM is the source of truth.
    const hcmBalance = Number(balance.value);
    let cancelledCount = 0;

    for (const req of pending) {
      if (Number(req.days) > hcmBalance) {
        await this.balanceService.restoreBalance(employeeId, locationId, Number(req.days));
        req.status = RequestStatus.CANCELLED;
        req.cancellationReason = CancellationReason.BALANCE_UPDATED_BY_HCM;
        await this.requestRepo.save(req);
        cancelledCount++;
      }
    }
    return cancelledCount;
  }
}
