// // src/common/filters/typeorm-exception.filter.ts
// import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus } from '@nestjs/common';
// import { QueryFailedError, EntityNotFoundError, TypeORMError } from 'typeorm';
// import { Response } from 'express';

// @Catch(TypeORMError)
// export class TypeOrmExceptionFilter implements ExceptionFilter {
//   catch(exception: TypeORMError, host: ArgumentsHost) {
//     const ctx = host.switchToHttp();
//     const response = ctx.getResponse<Response>();
    
//     let status = HttpStatus.INTERNAL_SERVER_ERROR;
//     let message = 'Error interno del servidor';
//     let error = 'Internal Server Error';

//     if (exception instanceof QueryFailedError) {
//       const err = exception as any;
      
//       switch (err.code) {
//         case '23505': // Unique violation
//           status = HttpStatus.CONFLICT;
//           const match = err.detail.match(/Key \((.*?)\)=\((.*?)\)/);
//           const field = match ? match[1] : 'campo';
//           const value = match ? match[2] : '';
//           message = `Ya existe un registro con el ${field}: ${value}`;
//           error = 'Conflict';
//           break;
          
//         case '23503': // Foreign key violation
//           status = HttpStatus.BAD_REQUEST;
//           message = 'No se puede realizar la operación porque hay registros relacionados';
//           error = 'Bad Request';
//           break;
          
//         case '22P02': // Invalid text representation
//           status = HttpStatus.BAD_REQUEST;
//           message = 'Formato inválido para el tipo de dato';
//           error = 'Bad Request';
//           break;

//         default:
//           status = HttpStatus.BAD_REQUEST;
//           message = 'Error en la operación de base de datos';
//           error = 'Bad Request';
//       }
//     } else if (exception instanceof EntityNotFoundError) {
//       status = HttpStatus.NOT_FOUND;
//       message = 'El recurso solicitado no existe';
//       error = 'Not Found';
//     }

//     response
//       .status(status)
//       .json({
//         statusCode: status,
//         message,
//         error,
//         ...(process.env.NODE_ENV === 'development' && {
//           detail: exception.message,
//           query: (exception as any).query,
//           parameters: (exception as any).parameters
//         })
//       });
//   }
// }

import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus } from '@nestjs/common';
import { QueryFailedError, EntityNotFoundError, TypeORMError } from 'typeorm';
import { Response } from 'express';

@Catch(TypeORMError)
export class TypeOrmExceptionFilter implements ExceptionFilter {
  catch(exception: TypeORMError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();
    
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Error interno del servidor';
    let error = 'Internal Server Error';

    if (exception instanceof QueryFailedError) {
      const err = exception as any;
      
      switch (err.code) {
        case '23505': // Unique violation
          status = HttpStatus.CONFLICT;
          const match = err.detail.match(/Key \((.*?)\)=\((.*?)\)/);
          if (match) {
            const field = match[1].split('.')[1] || match[1];
            const value = match[2];
            message = `Ya existe un registro con ${field}: ${value}`;
          } else {
            message = 'Ya existe un registro con los mismos datos';
          }
          error = 'Conflict';
          break;
          
        case '23503': // Foreign key violation
          status = HttpStatus.BAD_REQUEST;
          message = 'No se puede realizar la operación porque hay registros relacionados';
          error = 'Bad Request';
          break;
      }
    } else if (exception instanceof EntityNotFoundError) {
      status = HttpStatus.NOT_FOUND;
      message = 'El recurso solicitado no existe';
      error = 'Not Found';
    }

    return response.status(status).json({
      statusCode: status,
      message,
      error,
      details: {
        message,
        error,
        statusCode: status
      }
    });
  }
}