import {
  IsString,
  IsNotEmpty,
  IsDateString,
  IsNumber,
  Min,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

@ValidatorConstraint({ name: 'endDateAfterStartDate', async: false })
class EndDateAfterStartDate implements ValidatorConstraintInterface {
  validate(endDate: string, args: ValidationArguments) {
    const obj = args.object as any;
    if (!obj.startDate || !endDate) return true;
    return new Date(endDate) >= new Date(obj.startDate);
  }
  defaultMessage() {
    return 'endDate must be on or after startDate';
  }
}

export class CreateTimeOffRequestDto {
  @ApiProperty({ example: 'emp-123', description: 'Unique employee identifier' })
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @ApiProperty({ example: 'loc-us', description: 'Location identifier (balances are per employee per location)' })
  @IsString()
  @IsNotEmpty()
  locationId: string;

  @ApiProperty({ example: '2026-06-01', description: 'First day of the time-off period (YYYY-MM-DD)' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ example: '2026-06-05', description: 'Last day of the time-off period (YYYY-MM-DD); must be >= startDate' })
  @IsDateString()
  @Validate(EndDateAfterStartDate)
  endDate: string;

  @ApiProperty({ example: 3, description: 'Number of leave days requested (up to 2 decimal places)', minimum: 0.01 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Type(() => Number)
  days: number;
}
