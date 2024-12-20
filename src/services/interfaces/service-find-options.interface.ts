export interface ServiceFindOptions {
  id?: string;
  name?: string;
  ownerId: string;
  categoryId?: string;
  loadRelations?: boolean;
}
