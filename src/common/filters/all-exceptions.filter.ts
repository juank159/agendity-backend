// // src/common/filters/all-exceptions.filter.ts
// import { 
//     ExceptionFilter, 
//     Catch, 
//     ArgumentsHost, 
//     HttpException, 
//     HttpStatus 
//   } from '@nestjs/common';
//   import { Response } from 'express';
  
//   @Catch()
//   export class AllExceptionsFilter implements ExceptionFilter {
//     catch(exception: unknown, host: ArgumentsHost) {
//       const ctx = host.switchToHttp();
//       const response = ctx.getResponse<Response>();
  
//       // Si es una excepción HTTP de NestJS
//       if (exception instanceof HttpException) {
//         const status = exception.getStatus();
//         const exceptionResponse = exception.getResponse();
  
//         response
//           .status(status)
//           .json({
//             statusCode: status,
//             message: exception.message,
//             error: this.getErrorName(status),
//             details: exceptionResponse
//           });
//         return;
//       }
  
//       // Para otros tipos de errores
//       response
//         .status(HttpStatus.INTERNAL_SERVER_ERROR)
//         .json({
//           statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
//           message: 'Ha ocurrido un error interno en el servidor juank',
//           error: 'Internal Server Error'
//         });
//     }
  
//     private getErrorName(status: number): string {
//       switch (status) {
//         case 400: return 'Bad Request';
//         case 401: return 'Unauthorized';
//         case 403: return 'Forbidden';
//         case 404: return 'Not Found';
//         case 409: return 'Conflict';
//         default: return 'Internal Server Error';
//       }
//     }
//   }


import { 
    ExceptionFilter, 
    Catch, 
    ArgumentsHost, 
    HttpException, 
    HttpStatus 
  } from '@nestjs/common';
  import { Response } from 'express';
  
  @Catch()
  export class AllExceptionsFilter implements ExceptionFilter {
    catch(exception: unknown, host: ArgumentsHost) {
      const ctx = host.switchToHttp();
      const response = ctx.getResponse<Response>();
  
      // Si es una excepción HTTP de NestJS
      if (exception instanceof HttpException) {
        const status = exception.getStatus();
        const exceptionResponse = exception.getResponse();
  
        response
          .status(status)
          .json({
            statusCode: status,
            message: exception.message,
            error: this.getErrorName(status),
            details: exceptionResponse
          });
        return;
      }
  
      // Para otros tipos de errores
      response
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .json({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Ha ocurrido un error interno en el servidor',
          error: 'Internal Server Error',
          details: {
            message: 'Ha ocurrido un error interno en el servidor',
            error: 'Internal Server Error',
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR
          }
        });
    }
  
    private getErrorName(status: number): string {
      switch (status) {
        case 400: return 'Bad Request';
        case 401: return 'Unauthorized';
        case 403: return 'Forbidden';
        case 404: return 'Not Found';
        case 409: return 'Conflict';
        default: return 'Internal Server Error';
      }
    }
  }