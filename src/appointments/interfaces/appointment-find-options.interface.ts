export interface AppointmentFindOptions {
  id?: string;
  professionalId?: string;
  date?: Date;
  ownerId: string;
  excludeId?: string;
  loadRelations?: boolean;
}
