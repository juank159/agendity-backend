export interface ClientFindOptions {
  id?: string;
  email?: string;
  phone?: string;
  ownerId: string;
  loadRelations?: boolean;
}
