export interface AppointmentFindOptions {
  id?: string;
  professionalId?: string;
  date?: Date;
  excludeId?: string;
  loadRelations?: boolean;
}
