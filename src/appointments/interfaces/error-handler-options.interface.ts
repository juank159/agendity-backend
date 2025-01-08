export interface ErrorHandlerOptions {
  entity: 'la cita' | 'las citas';
  operation:
    | 'crear'
    | 'actualizar'
    | 'eliminar'
    | 'buscar'
    | 'listar'
    | 'validar';
  detail?: string;
}
