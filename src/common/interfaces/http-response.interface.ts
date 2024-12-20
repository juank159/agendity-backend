export interface HttpResponse<T = any> {
    statusCode: number;
    message: string | string[];
    error?: string;
    data?: T;
  }