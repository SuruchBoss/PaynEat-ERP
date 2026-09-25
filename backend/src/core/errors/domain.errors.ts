// Adapted from Cwork (backend/src/core/errors/domain.errors.ts), see NOTICE.
import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Domain errors carry a stable machine-readable `code` so clients (the web console,
 * PaynEat POS) can branch on the reason rather than on a translated message string.
 */
export class DomainError extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    readonly details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, status);
  }
}

export class NotFoundError extends DomainError {
  constructor(resource: string, id?: string) {
    super(
      'RESOURCE_NOT_FOUND',
      id ? `${resource} '${id}' was not found` : `${resource} was not found`,
      HttpStatus.NOT_FOUND,
    );
  }
}

export class ConflictError extends DomainError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, message, HttpStatus.CONFLICT, details);
  }
}

export class BusinessRuleError extends DomainError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, message, HttpStatus.UNPROCESSABLE_ENTITY, details);
  }
}

export class AccessDeniedError extends DomainError {
  constructor(message = 'You do not have access to this resource') {
    super('ACCESS_DENIED', message, HttpStatus.FORBIDDEN);
  }
}
