export class AppException extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly error: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ValidationException extends AppException {
  constructor(fields: Array<{ field: string; expectedType: string; issue: string }>) {
    super(400, 'VALIDATION_ERROR', 'Request validation failed', { fields });
  }
}

export class NotFoundException extends AppException {
  constructor(resourceType: string, id: string) {
    super(404, 'NOT_FOUND', `${resourceType} with id '${id}' not found`, {
      resourceType,
      id,
    });
  }
}

export class ConflictException extends AppException {
  constructor(currentStatus: string, requestedAction: string) {
    super(
      409,
      'INVALID_STATUS_TRANSITION',
      `Cannot ${requestedAction} a request with status ${currentStatus}`,
      { currentStatus, requestedAction },
    );
  }
}

export class InsufficientBalanceException extends AppException {
  constructor(available: number, requested: number) {
    super(
      422,
      'INSUFFICIENT_BALANCE',
      `Requested ${requested.toFixed(2)} days exceeds available balance of ${available.toFixed(2)} days`,
      { available, requested },
    );
  }
}

export class NegativeBalanceException extends AppException {
  constructor(value: number) {
    super(422, 'NEGATIVE_BALANCE', `Balance value ${value} must be non-negative`, { value });
  }
}

export class HcmClientException extends AppException {
  constructor(statusCode: number, hcmError: string, employeeId: string, locationId: string) {
    super(502, 'HCM_ERROR', `HCM returned error: ${hcmError}`, {
      hcmStatusCode: statusCode,
      employeeId,
      locationId,
    });
  }
}

export class HcmUnavailableException extends AppException {
  constructor(employeeId: string, locationId: string, attempts: number) {
    super(
      503,
      'HCM_UNAVAILABLE',
      `HCM service is unavailable after ${attempts} retry attempts`,
      { employeeId, locationId, attempts },
    );
  }
}
