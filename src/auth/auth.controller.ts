import {
  Controller,
  HttpCode,
  Post,
  Body,
  Get,
  Param,
  Patch,
  Delete,
  Query,
} from '@nestjs/common';

import { CreateAuthDto, CreateEmployeeDto, LoginAuthDto } from './dto';
import { AuthService } from './auth.service';
import { JwtRoles } from './jwt/jwt.role';
import { hasRoles } from './jwt/has.roles';
import { User } from '../users/entities/user.entity';
import { JwtPayload } from './interfaces';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { CreateEmployeeWithDetailsDto } from './dto/create-employee-with-details.dto';
import { ToggleEmployeeStatusDto } from './dto/toggle-employee-status.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Public } from '../common/decorators/public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register/owner')
  registerOwner(@Body() createAuthDto: CreateAuthDto) {
    return this.authService.createOwner(createAuthDto);
  }

  @hasRoles(JwtRoles.Owner)
  @Post('register/employee')
  createEmployee(
    @GetUser() owner: User,
    @Body() createEmployeeDto: CreateEmployeeWithDetailsDto, // Usar el nuevo DTO
  ) {
    return this.authService.createEmployee(createEmployeeDto, owner);
  }

  // NUEVO ENDPOINT PARA ACTUALIZAR EMPLEADO
  @hasRoles(JwtRoles.Owner)
  @Patch('employee/:id')
  updateEmployee(
    @GetUser() owner: User,
    @Param('id') employeeId: string,
    @Body() updateEmployeeDto: UpdateEmployeeDto,
  ) {
    return this.authService.updateEmployee(
      owner.id,
      employeeId,
      updateEmployeeDto,
    );
  }

  @hasRoles(JwtRoles.Owner)
  @Patch('employee/:id/status')
  toggleEmployeeStatus(
    @GetUser() owner: User,
    @Param('id') employeeId: string,
    @Body() statusDto: ToggleEmployeeStatusDto,
  ) {
    return this.authService.toggleEmployeeStatus(
      owner.id,
      employeeId,
      statusDto,
    );
  }

  // NUEVO ENDPOINT PARA ELIMINAR EMPLEADO
  @hasRoles(JwtRoles.Owner)
  @Delete('employee/:id')
  deleteEmployee(
    @GetUser() owner: User,
    @Param('id') employeeId: string,
    @Body('reason') reason?: string, // Razón opcional
  ) {
    return this.authService.deleteEmployee(owner.id, employeeId, reason);
  }

  @hasRoles(JwtRoles.Owner)
  @Patch('employee/:id/restore')
  restoreEmployee(@GetUser() owner: User, @Param('id') employeeId: string) {
    return this.authService.restoreEmployee(owner.id, employeeId);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() loginAuthDto: LoginAuthDto) {
    return this.authService.login(loginAuthDto);
  }

  @Public()
  @Post('google')
  @HttpCode(200)
  googleLogin(@Body('token') token: string) {
    return this.authService.googleLogin(token);
  }

  // @Post('verify/request-code')
  // requestVerificationCode(@Body('email') email: string) {
  //   return this.authService.generateVerificationCode(email);
  // }

  @Public()
  @Post('verify/request-code')
  requestVerificationCode(
    @Body('email') email: string,
    @Body('isNewUser') isNewUser: boolean = false,
  ) {
    return this.authService.generateVerificationCode(email, isNewUser);
  }

  @Public()
  @Post('verify/email')
  verifyEmail(@Body('email') email: string, @Body('code') code: string) {
    return this.authService.verifyEmail(email, code);
  }

  // @Post('forgot-password')
  // forgotPassword(@Body('email') email: string) {
  //   return this.authService.generatePasswordResetCode(email);
  // }

  @Public()
  @Post('forgot-password')
  forgotPassword(@Body('email') email: string) {
    return this.authService.generatePasswordResetCode(email);
  }

  // @Post('reset-password')
  // resetPassword(
  //   @Body('email') email: string,
  //   @Body('code') code: string,
  //   @Body('new_password') newPassword: string,
  // ) {
  //   return this.authService.resetPassword(email, code, newPassword);
  // }

  @Public()
  @Post('reset-password')
  resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(
      resetPasswordDto.email,
      resetPasswordDto.code,
      resetPasswordDto.newPassword,
    );
  }

  @hasRoles(JwtRoles.Owner)
  @Get('employees')
  getEmployees(
    @GetUser() owner: User,
    @Query('includeDeleted') includeDeleted?: string, // Parámetro opcional
  ) {
    const shouldIncludeDeleted = includeDeleted === 'true';
    return this.authService.getEmployeesByOwner(owner.id, shouldIncludeDeleted);
  }

  @hasRoles(JwtRoles.Owner)
  @Get('employee/:id')
  getEmployee(@GetUser() owner: User, @Param('id') employeeId: string) {
    return this.authService.getEmployeeByOwner(owner.id, employeeId);
  }

  @hasRoles(JwtRoles.Owner)
  @Get('employees/deleted')
  getDeletedEmployees(@GetUser() owner: User) {
    return this.authService.getDeletedEmployeesByOwner(owner.id);
  }

  // 🆕 NUEVO: Endpoint específico para empleados activos
  @hasRoles(JwtRoles.Owner)
  @Get('employees/active')
  getActiveEmployees(@GetUser() owner: User) {
    return this.authService.getActiveEmployeesByOwner(owner.id);
  }

  // La app la llama con la sesión del Owner (verify_employee_email_controller.dart).
  @hasRoles(JwtRoles.Owner)
  @Post('verify/employee-email')
  verifyEmployeeEmail(
    @GetUser() owner: JwtPayload,
    @Body('employee_id') employeeId: string,
    @Body('code') code: string,
  ) {
    return this.authService.verifyEmployeeEmail(owner, employeeId, code);
  }
}
