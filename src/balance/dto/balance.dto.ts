import { IsString, IsNotEmpty, IsNumber, Min, IsOptional, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBalanceDto {
  @ApiProperty({ example: 'emp-123', description: 'Employee identifier' })
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @ApiProperty({ example: 'loc-us', description: 'Location identifier' })
  @IsString()
  @IsNotEmpty()
  locationId: string;

  @ApiProperty({ example: 10, description: 'Initial balance value (non-negative, up to 2 decimal places)', minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  value: number;
}

export class DiscrepancyQueryDto {
  @ApiPropertyOptional({ example: 'emp-123', description: 'Filter by employee ID' })
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiPropertyOptional({ example: 'loc-us', description: 'Filter by location ID' })
  @IsOptional()
  @IsString()
  locationId?: string;

  @ApiPropertyOptional({ example: '2026-01-01', description: 'Return discrepancies detected on or after this date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31', description: 'Return discrepancies detected on or before this date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class BalanceResponseDto {
  @ApiProperty({ example: 'emp-123' })
  employeeId: string;

  @ApiProperty({ example: 'loc-us' })
  locationId: string;

  @ApiProperty({ example: 7.5, description: 'Current balance in days' })
  value: number;

  @ApiProperty({ example: 'HCM_REALTIME', enum: ['EMPLOYEE_REQUEST', 'HCM_REALTIME', 'HCM_BATCH', 'HCM_CONFLICT_RESOLUTION'] })
  lastUpdateSource: string;

  @ApiProperty({ example: '2026-05-12T18:00:00.000Z' })
  updatedAt: Date;
}
