import { IsString, IsNotEmpty, IsNumber, Min, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

export class SetBalanceDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  balance: number;
}

export class SimulateBalanceChangeDto {
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @IsString()
  @IsNotEmpty()
  locationId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  balance: number;
}

export class InjectErrorDto {
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @IsString()
  @IsNotEmpty()
  locationId: string;

  @IsInt()
  @Min(400)
  @Type(() => Number)
  statusCode: number;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  times: number;
}
