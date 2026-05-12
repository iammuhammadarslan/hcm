import { IsArray, ValidateNested, IsString, IsNotEmpty, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class BatchSyncRecordDto {
  @ApiProperty({ example: 'emp-123', description: 'Employee identifier' })
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @ApiProperty({ example: 'loc-us', description: 'Location identifier' })
  @IsString()
  @IsNotEmpty()
  locationId: string;

  @ApiProperty({ example: 15, description: 'Authoritative balance from HCM (non-negative)', minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  balance: number;
}

export class BatchSyncDto {
  @ApiProperty({ type: [BatchSyncRecordDto], description: 'Array of balance records from HCM' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchSyncRecordDto)
  records: BatchSyncRecordDto[];
}

export class BatchSyncSummaryDto {
  @ApiProperty({ example: 10, description: 'Total records received in the payload' })
  received: number;

  @ApiProperty({ example: 3, description: 'Records where local balance was updated to match HCM' })
  updated: number;

  @ApiProperty({ example: 1, description: 'Pending requests cancelled because the new balance was insufficient' })
  cancelled: number;

  @ApiProperty({ example: 0, description: 'Records skipped due to negative balance value' })
  skipped: number;
}
