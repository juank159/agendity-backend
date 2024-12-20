import { Injectable, LoggerService } from '@nestjs/common';

@Injectable()
export class CustomLoggerService implements LoggerService {
  log(message: string) {
    console.log(`[LOG] ${new Date().toISOString()} - ${message}`);
  }

  error(message: string, trace: string) {
    console.error(`[ERROR] ${new Date().toISOString()} - ${message}`);
    console.error(trace);
  }

  warn(message: string) {
    console.warn(`[WARN] ${new Date().toISOString()} - ${message}`);
  }

  debug(message: string) {
    console.debug(`[DEBUG] ${new Date().toISOString()} - ${message}`);
  }

  verbose(message: string) {
    console.log(`[VERBOSE] ${new Date().toISOString()} - ${message}`);
  }
}