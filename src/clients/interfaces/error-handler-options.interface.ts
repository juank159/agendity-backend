export interface ErrorHandlerOptions {
  entity: 'el cliente' | 'los clientes';
  operation: 'crear' | 'actualizar' | 'eliminar' | 'buscar' | 'listar';
  detail?: string;
}
