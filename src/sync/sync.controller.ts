import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { SyncService } from './sync.service';
import { BatchSyncDto, BatchSyncSummaryDto } from './dto/batch-sync.dto';
import { ErrorResponseDto } from '../common/dto/error-response.dto';

@ApiTags('hcm-sync')
@Controller('hcm')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('batch-sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Receive a batch balance update from HCM',
    description:
      'Processes the full corpus of balances sent by the HCM system (e.g. work anniversary ' +
      'refresh, year-start allocation). For each record: upserts the local balance, detects ' +
      'discrepancies, and cancels any pending requests that exceed the new balance. ' +
      'Records with a negative balance value are skipped.',
  })
  @ApiBody({ type: BatchSyncDto })
  @ApiResponse({ status: 200, description: 'Sync completed — returns processing summary', type: BatchSyncSummaryDto })
  @ApiResponse({ status: 400, description: 'Validation error in payload', type: ErrorResponseDto })
  batchSync(@Body() dto: BatchSyncDto) {
    return this.syncService.processBatchSync(dto.records);
  }
}
