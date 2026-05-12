import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { MockHcmService } from './mock-hcm.service';
import { SetBalanceDto, SimulateBalanceChangeDto, InjectErrorDto } from './dto/mock-hcm.dto';

@Controller('hcm')
export class MockHcmController {
  constructor(private readonly service: MockHcmService) {}

  @Get('balances/:employeeId/:locationId')
  getBalance(
    @Param('employeeId') employeeId: string,
    @Param('locationId') locationId: string,
  ) {
    const balance = this.service.getBalance(employeeId, locationId);
    return { employeeId, locationId, balance };
  }

  @Put('balances/:employeeId/:locationId')
  @HttpCode(HttpStatus.OK)
  setBalance(
    @Param('employeeId') employeeId: string,
    @Param('locationId') locationId: string,
    @Body() dto: SetBalanceDto,
  ) {
    const balance = this.service.setBalance(employeeId, locationId, dto.balance);
    return { employeeId, locationId, balance };
  }

  @Post('simulate/balance-change')
  @HttpCode(HttpStatus.OK)
  simulateBalanceChange(@Body() dto: SimulateBalanceChangeDto) {
    this.service.simulateBalanceChange(dto.employeeId, dto.locationId, dto.balance);
    return { message: 'Balance updated', ...dto };
  }

  @Post('simulate/error')
  @HttpCode(HttpStatus.OK)
  injectError(@Body() dto: InjectErrorDto) {
    this.service.injectError(dto.employeeId, dto.locationId, dto.statusCode, dto.times);
    return { message: `Error ${dto.statusCode} injected for next ${dto.times} requests` };
  }

  @Delete('reset')
  @HttpCode(HttpStatus.OK)
  reset() {
    this.service.reset();
    return { message: 'Mock HCM state reset' };
  }

  @Get('state')
  getState() {
    return this.service.getState();
  }
}
