export interface ErrorHandlerOptions {
  entity: 'la reseña' | 'las reseñas';
  operation: 'crear' | 'actualizar' | 'eliminar' | 'buscar' | 'listar';
  detail?: string;
}
