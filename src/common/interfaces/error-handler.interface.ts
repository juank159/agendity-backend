export type OperationType =
  | 'crear'
  | 'actualizar'
  | 'eliminar'
  | 'buscar'
  | 'validar'
  | 'listar'
  | 'modificar'
  | 'procesar'
  | 'verificar'
  | 'consultar';

export interface ErrorHandlerOptions {
  entity: string;
  operation: OperationType;
  detail?: string;
}
