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
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { CreateEmployeeWithDetailsDto } from './dto/create-employee-with-details.dto';
import { ToggleEmployeeStatusDto } from './dto/toggle-employee-status.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Public } from '../common/decorators/public.decorator';
import {
  AUTH_RATE_LIMITS,
  RateLimit,
} from '../common/decorators/rate-limit.decorator';
import { AuthUser } from './interfaces';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @RateLimit(AUTH_RATE_LIMITS.registerOwner)
  @Post('register/owner')
  registerOwner(@Body() createAuthDto: CreateAuthDto) {
    return this.authService.createOwner(createAuthDto);
  }

  @hasRoles(JwtRoles.Owner)
  @Post('register/employee')
  createEmployee(
    @CurrentUser() owner: AuthUser,
    @Body() createEmployeeDto: CreateEmployeeWithDetailsDto, // Usar el nuevo DTO
  ) {
    return this.authService.createEmployee(createEmployeeDto, owner);
  }

  // NUEVO ENDPOINT PARA ACTUALIZAR EMPLEADO
  @hasRoles(JwtRoles.Owner)
  @Patch('employee/:id')
  updateEmployee(
    @CurrentUser() owner: AuthUser,
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
    @CurrentUser() owner: AuthUser,
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
    @CurrentUser() owner: AuthUser,
    @Param('id') employeeId: string,
    @Body('reason') reason?: string, // Razón opcional
  ) {
    return this.authService.deleteEmployee(owner.id, employeeId, reason);
  }

  @hasRoles(JwtRoles.Owner)
  @Patch('employee/:id/restore')
  restoreEmployee(
    @CurrentUser() owner: AuthUser,
    @Param('id') employeeId: string,
  ) {
    return this.authService.restoreEmployee(owner.id, employeeId);
  }

  @Public()
  @RateLimit(AUTH_RATE_LIMITS.login)
  @Post('login')
  @HttpCode(200)
  login(@Body() loginAuthDto: LoginAuthDto) {
    return this.authService.login(loginAuthDto);
  }

  @Public()
  @RateLimit(AUTH_RATE_LIMITS.google)
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
  @RateLimit(AUTH_RATE_LIMITS.requestCode)
  @Post('verify/request-code')
  requestVerificationCode(
    @Body('email') email: string,
    @Body('isNewUser') isNewUser: boolean = false,
  ) {
    return this.authService.generateVerificationCode(email, isNewUser);
  }

  @Public()
  @RateLimit(AUTH_RATE_LIMITS.verifyCode)
  @Post('verify/email')
  verifyEmail(@Body('email') email: string, @Body('code') code: string) {
    return this.authService.verifyEmail(email, code);
  }

  // @Post('forgot-password')
  // forgotPassword(@Body('email') email: string) {
  //   return this.authService.generatePasswordResetCode(email);
  // }

  @Public()
  @RateLimit(AUTH_RATE_LIMITS.forgotPassword)
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
  @RateLimit(AUTH_RATE_LIMITS.verifyCode)
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
    @CurrentUser() owner: AuthUser,
    @Query('includeDeleted') includeDeleted?: string, // Parámetro opcional
  ) {
    const shouldIncludeDeleted = includeDeleted === 'true';
    return this.authService.getEmployeesByOwner(owner.id, shouldIncludeDeleted);
  }

  @hasRoles(JwtRoles.Owner)
  @Get('employee/:id')
  getEmployee(@CurrentUser() owner: AuthUser, @Param('id') employeeId: string) {
    return this.authService.getEmployeeByOwner(owner.id, employeeId);
  }

  @hasRoles(JwtRoles.Owner)
  @Get('employees/deleted')
  getDeletedEmployees(@CurrentUser() owner: AuthUser) {
    return this.authService.getDeletedEmployeesByOwner(owner.id);
  }

  // 🆕 NUEVO: Endpoint específico para empleados activos
  @hasRoles(JwtRoles.Owner)
  @Get('employees/active')
  getActiveEmployees(@CurrentUser() owner: AuthUser) {
    return this.authService.getActiveEmployeesByOwner(owner.id);
  }

  // La app la llama con la sesión del Owner (verify_employee_email_controller.dart).
  @hasRoles(JwtRoles.Owner)
  @RateLimit(AUTH_RATE_LIMITS.verifyCode)
  @Post('verify/employee-email')
  verifyEmployeeEmail(
    @CurrentUser() owner: AuthUser,
    @Body('employee_id') employeeId: string,
    @Body('code') code: string,
  ) {
    return this.authService.verifyEmployeeEmail(owner, employeeId, code);
  }
}
