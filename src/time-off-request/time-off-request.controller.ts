import {
  Controller,
  Post,
  Get,
  Patch,
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
import { TimeOffRequestService } from './time-off-request.service';
import { CreateTimeOffRequestDto } from './dto/create-time-off-request.dto';
import { TimeOffRequest } from './entities/time-off-request.entity';
import { ErrorResponseDto } from '../common/dto/error-response.dto';

@ApiTags('time-off-requests')
@Controller('time-off-requests')
export class TimeOffRequestController {
  constructor(private readonly service: TimeOffRequestService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Submit a time-off request',
    description:
      'Creates a PENDING request and immediately reserves the requested days from the ' +
      "employee's local balance. Returns 422 if the balance is insufficient.",
  })
  @ApiBody({ type: CreateTimeOffRequestDto })
  @ApiResponse({ status: 201, description: 'Request created and balance reserved', type: TimeOffRequest })
  @ApiResponse({ status: 400, description: 'Validation error', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Balance not found for this employee/location', type: ErrorResponseDto })
  @ApiResponse({ status: 422, description: 'Insufficient balance', type: ErrorResponseDto })
  create(@Body() dto: CreateTimeOffRequestDto) {
    return this.service.createRequest(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List requests for an employee',
    description: 'Returns all time-off requests for the given employee, ordered by submission date descending.',
  })
  @ApiQuery({ name: 'employeeId', required: true, example: 'emp-123', description: 'Employee identifier' })
  @ApiResponse({ status: 200, description: 'List of requests', type: [TimeOffRequest] })
  list(@Query('employeeId') employeeId: string) {
    return this.service.listRequests(employeeId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single request by ID' })
  @ApiParam({ name: 'id', description: 'Request UUID' })
  @ApiResponse({ status: 200, description: 'Request found', type: TimeOffRequest })
  @ApiResponse({ status: 404, description: 'Request not found', type: ErrorResponseDto })
  findOne(@Param('id') id: string) {
    return this.service.getRequest(id);
  }

  @Patch(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve a pending request',
    description:
      'Fetches the authoritative balance from HCM, syncs locally, then deducts the days ' +
      'from HCM. Performs a post-write read to detect discrepancies. ' +
      'If HCM is unavailable or rejects the deduction, the reserved balance is restored ' +
      'and the request stays PENDING for retry.',
  })
  @ApiParam({ name: 'id', description: 'Request UUID' })
  @ApiResponse({ status: 200, description: 'Request approved', type: TimeOffRequest })
  @ApiResponse({ status: 404, description: 'Request not found', type: ErrorResponseDto })
  @ApiResponse({ status: 409, description: 'Request is not in PENDING status', type: ErrorResponseDto })
  @ApiResponse({ status: 422, description: 'HCM balance insufficient for this request', type: ErrorResponseDto })
  @ApiResponse({ status: 503, description: 'HCM service unavailable', type: ErrorResponseDto })
  approve(@Param('id') id: string) {
    return this.service.approveRequest(id);
  }

  @Patch(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reject a pending request',
    description: 'Marks the request as REJECTED and restores the reserved balance.',
  })
  @ApiParam({ name: 'id', description: 'Request UUID' })
  @ApiResponse({ status: 200, description: 'Request rejected and balance restored', type: TimeOffRequest })
  @ApiResponse({ status: 404, description: 'Request not found', type: ErrorResponseDto })
  @ApiResponse({ status: 409, description: 'Request is not in PENDING status', type: ErrorResponseDto })
  reject(@Param('id') id: string) {
    return this.service.rejectRequest(id);
  }

  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a pending request',
    description: 'Marks the request as CANCELLED with reason EMPLOYEE_CANCELLED and restores the reserved balance.',
  })
  @ApiParam({ name: 'id', description: 'Request UUID' })
  @ApiResponse({ status: 200, description: 'Request cancelled and balance restored', type: TimeOffRequest })
  @ApiResponse({ status: 404, description: 'Request not found', type: ErrorResponseDto })
  @ApiResponse({ status: 409, description: 'Request is not in PENDING status', type: ErrorResponseDto })
  cancel(@Param('id') id: string) {
    return this.service.cancelRequest(id);
  }
}
