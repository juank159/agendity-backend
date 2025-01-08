export interface ReviewFindOptions {
  id?: string;
  professionalId?: string;
  appointmentId?: string;
  ownerId: string;
  loadRelations?: boolean;
}
