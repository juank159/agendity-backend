interface ErrorHandlerOptions {
  entity: string;
  operation:
    | 'crear'
    | 'actualizar'
    | 'eliminar'
    | 'buscar'
    | 'listar'
    | 'batch'; // Agregar 'batch'
  detail?: string;
}
