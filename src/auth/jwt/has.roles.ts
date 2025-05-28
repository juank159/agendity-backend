// import { SetMetadata } from "@nestjs/common";
// import { JwtRoles } from "./jwt.role";

// export const hasRoles = (...roles: JwtRoles[]) => SetMetadata('roles', roles);

// jwt/has.roles.ts
import { SetMetadata } from '@nestjs/common';
import { JwtRoles } from './jwt.role';

export const ROLES_KEY = 'roles';
export const hasRoles = (...roles: JwtRoles[]) => SetMetadata(ROLES_KEY, roles);
