import {
  Controller,
  HttpCode,
  Post,
  Body,
  UseGuards,
  Get,
  Param,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { CreateAuthDto, CreateEmployeeDto, LoginAuthDto } from './dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtRoles } from './jwt/jwt.role';
import { JwtAuthGuard } from './jwt/jwt.auth.guard';
import { JwtRolesGuard } from './jwt/jwt.roles.guard';
import { hasRoles } from './jwt/has.roles';

import { User } from '../users/entities/user.entity';
import { GetUser } from 'src/common/decorators/get-user.decorator';

@ApiTags('Autenticación')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register/owner')
  @ApiOperation({
    summary: 'Registrar un nuevo dueño de negocio',
    description: 'Crea un nuevo usuario con rol de Owner y su propio tenant',
  })
  @ApiBody({ type: CreateAuthDto })
  @ApiResponse({
    status: 201,
    description: 'Owner creado exitosamente',
    schema: {
      properties: {
        user: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            email: { type: 'string' },
            tenant_id: { type: 'string' },
            roles: { type: 'array', items: { type: 'string' } },
          },
        },
        token: { type: 'string' },
      },
    },
  })
  registerOwner(@Body() createAuthDto: CreateAuthDto) {
    return this.authService.createOwner(createAuthDto);
  }

  @hasRoles(JwtRoles.Owner)
  @UseGuards(JwtAuthGuard, JwtRolesGuard)
  @Post('register/employee')
  @ApiBearerAuth()
  @hasRoles(JwtRoles.Owner)
  @UseGuards(JwtAuthGuard, JwtRolesGuard)
  @ApiOperation({
    summary: 'Registrar un nuevo empleado',
    description: 'Permite a un Owner registrar empleados en su negocio',
  })
  @ApiBody({ type: CreateEmployeeDto })
  @ApiResponse({
    status: 201,
    description: 'Empleado creado exitosamente',
  })
  createEmployee(
    @GetUser() owner: User,
    @Body() createEmployeeDto: CreateEmployeeDto,
  ) {
    return this.authService.createEmployee(createEmployeeDto, owner);
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Iniciar sesión',
    description:
      'Autentica cualquier usuario (Owner, Employee) y retorna el token',
  })
  @ApiBody({ type: LoginAuthDto })
  @ApiResponse({
    status: 200,
    description: 'Login exitoso',
    schema: {
      properties: {
        user: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            email: { type: 'string' },
            tenant_id: { type: 'string' },
            owner_id: { type: 'string' },
            roles: { type: 'array', items: { type: 'string' } },
          },
        },
        token: { type: 'string' },
      },
    },
  })
  login(@Body() loginAuthDto: LoginAuthDto) {
    return this.authService.login(loginAuthDto);
  }

  @hasRoles(JwtRoles.Owner)
  @UseGuards(JwtAuthGuard, JwtRolesGuard)
  @Get('employees')
  @ApiBearerAuth()
  @hasRoles(JwtRoles.Owner)
  @UseGuards(JwtAuthGuard, JwtRolesGuard)
  @ApiOperation({
    summary: 'Obtener empleados',
    description: 'Obtiene la lista de empleados del Owner autenticado',
  })
  getEmployees(@GetUser() owner: User) {
    return this.authService.getEmployeesByOwner(owner.id);
  }

  @hasRoles(JwtRoles.Owner)
  @UseGuards(JwtAuthGuard, JwtRolesGuard)
  @Get('employee/:id')
  @ApiBearerAuth()
  @hasRoles(JwtRoles.Owner)
  @UseGuards(JwtAuthGuard, JwtRolesGuard)
  @ApiOperation({
    summary: 'Obtener empleado específico',
    description: 'Obtiene los detalles de un empleado específico del Owner',
  })
  getEmployee(@GetUser() owner: User, @Param('id') employeeId: string) {
    return this.authService.getEmployeeByOwner(owner.id, employeeId);
  }
}
