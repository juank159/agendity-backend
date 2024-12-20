import { SetMetadata } from "@nestjs/common";
import { JwtRoles } from "./jwt.role";

export const hasRoles = (...roles: JwtRoles[]) => SetMetadata('roles', roles);