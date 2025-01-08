export interface ErrorHandlerOptions {
  entity: 'el pago' | 'los pagos';
  operation: 'crear' | 'actualizar' | 'reembolsar' | 'buscar' | 'listar';
  detail?: string;
}
