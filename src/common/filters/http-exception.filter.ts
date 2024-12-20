import {
    ExceptionFilter,
    Catch,
    ArgumentsHost,
    HttpException,
  } from '@nestjs/common';
  import { Response } from 'express';
  import { HttpResponse } from '../interfaces/http-response.interface';
  
  @Catch(HttpException)
  export class HttpExceptionFilter implements ExceptionFilter {
    catch(exception: HttpException, host: ArgumentsHost) {
      const ctx = host.switchToHttp();
      const response = ctx.getResponse<Response>();
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse() as any;
  
      const responseBody: HttpResponse = {
        statusCode: status,
        message: exceptionResponse.message || exception.message,
        error: exceptionResponse.error,
        data: process.env.NODE_ENV === 'development' ? {
          stack: exception.stack,
        } : undefined
      };
  
      response
        .status(status)
        .json(responseBody);
    }
  }