// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Adapted from Cwork (backend/src/core/http/all-exceptions.filter.ts), see NOTICE.
// The ERP has no uploads, so Cwork's multer mapping is left out; the failure is
// reported on the request's `http.request.completed` line instead of a line of its own.
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { RequestWithId, RESPONSE_ERROR } from './request-context.middleware';
import { requestPath } from '../telemetry/domain/log-record';

interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  path: string;
  requestId?: string;
  timestamp: string;
}

/**
 * Single exit point for every error. Two rules:
 *  1. Clients get a stable `code` plus a safe message — never a stack trace or a
 *     database error string that leaks column names.
 *  2. The request id is in the body, so a user's report can be tied to the log line
 *     that carries the full error (written once, on `http.request.completed`).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithId>();

    const body = this.toErrorBody(exception, request);
    if (body.statusCode >= 500) {
      response.locals[RESPONSE_ERROR] = exception;
    }
    response.status(body.statusCode).json(body);
  }

  private toErrorBody(exception: unknown, request: RequestWithId): ErrorBody {
    const base = {
      // Path only: a query string can carry anything, including what must never be echoed.
      path: requestPath(request.originalUrl ?? request.url),
      requestId: request.id,
      timestamp: new Date().toISOString(),
    };

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'object' && payload !== null) {
        const p = payload as Record<string, unknown>;
        return {
          ...base,
          statusCode: status,
          code: (p.code as string) ?? defaultCodeFor(status),
          message: normaliseMessage(p.message ?? exception.message),
          details: p.details ?? (Array.isArray(p.message) ? p.message : undefined),
        };
      }
      return {
        ...base,
        statusCode: status,
        code: defaultCodeFor(status),
        message: String(payload),
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return { ...base, ...mapPrismaError(exception) };
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        ...base,
        statusCode: HttpStatus.BAD_REQUEST,
        code: 'INVALID_QUERY',
        message: 'The request could not be processed',
      };
    }

    return {
      ...base,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    };
  }
}

function normaliseMessage(message: unknown): string {
  if (Array.isArray(message)) return message.join('; ');
  return String(message);
}

function defaultCodeFor(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'VALIDATION_FAILED';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHENTICATED';
    case HttpStatus.FORBIDDEN:
      return 'ACCESS_DENIED';
    case HttpStatus.NOT_FOUND:
      return 'RESOURCE_NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    case HttpStatus.PAYLOAD_TOO_LARGE:
      return 'PAYLOAD_TOO_LARGE';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'RATE_LIMITED';
    default:
      return 'ERROR';
  }
}

/** Prisma codes carry column names, so we translate rather than forward them. */
function mapPrismaError(error: Prisma.PrismaClientKnownRequestError): {
  statusCode: number;
  code: string;
  message: string;
} {
  switch (error.code) {
    case 'P2002':
      return {
        statusCode: HttpStatus.CONFLICT,
        code: 'DUPLICATE_VALUE',
        message: 'A record with these unique values already exists',
      };
    case 'P2003':
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        code: 'INVALID_REFERENCE',
        message: 'A referenced record does not exist',
      };
    case 'P2025':
      return {
        statusCode: HttpStatus.NOT_FOUND,
        code: 'RESOURCE_NOT_FOUND',
        message: 'The requested record was not found',
      };
    default:
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'DATABASE_ERROR',
        message: 'A database error occurred',
      };
  }
}
