import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BalanceService } from '../balance/balance.service';
import { TimeOffRequestService } from '../time-off-request/time-off-request.service';
import { HcmClientService } from '../hcm-client/hcm-client.service';
import { UpdateSource } from '../balance/entities/balance.entity';
import { DetectedDuring } from '../balance/entities/balance-discrepancy.entity';
import { BatchSyncRecordDto } from './dto/batch-sync.dto';

export interface BatchSyncSummary {
  received: number;
  updated: number;
  cancelled: number;
  skipped: number;
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly balanceService: BalanceService,
    private readonly timeOffRequestService: TimeOffRequestService,
    private readonly hcmClient: HcmClientService,
  ) {}

  async processBatchSync(records: BatchSyncRecordDto[]): Promise<BatchSyncSummary> {
    const summary: BatchSyncSummary = { received: records.length, updated: 0, cancelled: 0, skipped: 0 };

    for (const record of records) {
      // Validate record
      if (record.balance < 0) {
        this.logger.warn(`Batch sync: skipping record with negative balance for ${record.employeeId}/${record.locationId}`);
        summary.skipped++;
        continue;
      }

      // HCM is the source of truth — upsert the balance so new employees
      // introduced by a work anniversary or year-start refresh are created locally.
      await this.balanceService.getOrCreate(
        record.employeeId,
        record.locationId,
        record.balance,
      );

      const { updated } = await this.balanceService.syncIfDifferent(
        record.employeeId,
        record.locationId,
        record.balance,
        UpdateSource.HCM_BATCH,
        DetectedDuring.BATCH_SYNC,
      );

      if (updated) {
        summary.updated++;
        const cancelled = await this.timeOffRequestService.reEvaluatePendingRequests(
          record.employeeId,
          record.locationId,
        );
        summary.cancelled += cancelled;
      }
    }

    this.logger.log(`Batch sync complete: ${JSON.stringify(summary)}`);
    return summary;
  }

  @Cron(process.env.SYNC_JOB_CRON ?? '0 * * * *')
  async runConflictResolutionJob(): Promise<void> {
    this.logger.log('Running scheduled conflict resolution job');
    const dimensions = await this.balanceService.getRecentlyUpdatedDimensions(24);

    for (const dim of dimensions) {
      try {
        const hcmBalance = await this.hcmClient.getBalance(dim.employeeId, dim.locationId);
        const { updated } = await this.balanceService.syncIfDifferent(
          dim.employeeId,
          dim.locationId,
          hcmBalance,
          UpdateSource.HCM_CONFLICT_RESOLUTION,
          DetectedDuring.CONFLICT_RESOLUTION,
        );
        if (updated) {
          await this.timeOffRequestService.reEvaluatePendingRequests(dim.employeeId, dim.locationId);
        }
      } catch (err) {
        this.logger.error(
          `Conflict resolution failed for ${dim.employeeId}/${dim.locationId}: ${(err as Error).message}`,
        );
      }
    }
  }
}
