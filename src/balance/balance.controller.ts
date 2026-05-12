import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { BalanceService } from './balance.service';
import { HcmClientService } from '../hcm-client/hcm-client.service';
import { Balance, UpdateSource } from './entities/balance.entity';
import { DetectedDuring } from './entities/balance-discrepancy.entity';
import { DiscrepancyQueryDto, CreateBalanceDto, BalanceResponseDto } from './dto/balance.dto';
import { ErrorResponseDto } from '../common/dto/error-response.dto';

@ApiTags('balances')
@Controller('balances')
export class BalanceController {
  constructor(
    private readonly balanceService: BalanceService,
    private readonly hcmClient: HcmClientService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Seed or upsert a balance',
    description: 'Creates or overwrites the local balance for an employee/location. Used for initial setup and testing.',
  })
  @ApiBody({ type: CreateBalanceDto })
  @ApiResponse({ status: 201, description: 'Balance created or updated', type: BalanceResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error', type: ErrorResponseDto })
  async createBalance(@Body() dto: CreateBalanceDto) {
    const balance = await this.balanceService.updateBalance(
      dto.employeeId,
      dto.locationId,
      dto.value,
      UpdateSource.EMPLOYEE_REQUEST,
    );
    return this.toDto(balance);
  }

  @Get('discrepancies')
  @ApiOperation({
    summary: 'List balance discrepancy events',
    description:
      'Returns recorded events where the local balance differed from HCM. ' +
      'Filterable by employee, location, and detection date range.',
  })
  @ApiResponse({ status: 200, description: 'List of discrepancy events' })
  async getDiscrepancies(@Query() query: DiscrepancyQueryDto) {
    return this.balanceService.getDiscrepancies(query);
  }

  @Get(':employeeId/:locationId')
  @ApiOperation({ summary: 'Get local balance for an employee/location' })
  @ApiParam({ name: 'employeeId', example: 'emp-123' })
  @ApiParam({ name: 'locationId', example: 'loc-us' })
  @ApiResponse({ status: 200, description: 'Current local balance', type: BalanceResponseDto })
  @ApiResponse({ status: 404, description: 'Balance not found', type: ErrorResponseDto })
  async getBalance(
    @Param('employeeId') employeeId: string,
    @Param('locationId') locationId: string,
  ) {
    const balance = await this.balanceService.getBalance(employeeId, locationId);
    return this.toDto(balance);
  }

  @Post(':employeeId/:locationId/sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Trigger real-time HCM sync',
    description:
      'Fetches the current balance from HCM and updates the local record if they differ. ' +
      'Records a discrepancy event when a difference is detected.',
  })
  @ApiParam({ name: 'employeeId', example: 'emp-123' })
  @ApiParam({ name: 'locationId', example: 'loc-us' })
  @ApiResponse({ status: 200, description: 'Balance after sync (may be unchanged)', type: BalanceResponseDto })
  @ApiResponse({ status: 404, description: 'Balance not found locally', type: ErrorResponseDto })
  @ApiResponse({ status: 503, description: 'HCM service unavailable', type: ErrorResponseDto })
  async syncBalance(
    @Param('employeeId') employeeId: string,
    @Param('locationId') locationId: string,
  ) {
    const hcmValue = await this.hcmClient.getBalance(employeeId, locationId);
    const { balance } = await this.balanceService.syncIfDifferent(
      employeeId,
      locationId,
      hcmValue,
      UpdateSource.HCM_REALTIME,
      DetectedDuring.REALTIME_SYNC,
    );
    return this.toDto(balance);
  }

  private toDto(balance: Balance): BalanceResponseDto {
    return {
      employeeId: balance.employeeId,
      locationId: balance.locationId,
      value: Number(balance.value),
      lastUpdateSource: balance.lastUpdateSource,
      updatedAt: balance.updatedAt,
    };
  }
}
