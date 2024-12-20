export interface JwtPayload {
  id: string;
  name: string;
  roles?: string[];
  tenant_id?: string;
  owner_id?: string;
}
