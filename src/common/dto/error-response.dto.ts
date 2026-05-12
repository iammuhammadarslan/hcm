import { ApiProperty } from '@nestjs/swagger';

export class ErrorResponseDto {
  @ApiProperty({ example: 422 })
  statusCode: number;

  @ApiProperty({ example: 'INSUFFICIENT_BALANCE' })
  error: string;

  @ApiProperty({ example: 'Requested 5.00 days exceeds available balance of 3.00 days' })
  message: string;

  @ApiProperty({ required: false, example: { available: 3, requested: 5 } })
  details?: Record<string, unknown>;
}
