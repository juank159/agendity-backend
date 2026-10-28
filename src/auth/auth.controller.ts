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

import { LoginAuthDto, RegisterOwnerDto } from './dto';
import { AuthService } from './auth.service';
import { EmployeesService } from './employees.service';
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
  constructor(
    private readonly authService: AuthService,
    private readonly employeesService: EmployeesService,
  ) {}

  @Public()
  @RateLimit(AUTH_RATE_LIMITS.registerOwner)
  @Post('register/owner')
  registerOwner(@Body() registerOwnerDto: RegisterOwnerDto) {
    return this.authService.createOwner(registerOwnerDto);
  }

  @hasRoles(JwtRoles.Owner)
  @Post('register/employee')
  createEmployee(
    @CurrentUser() owner: AuthUser,
    @Body() createEmployeeDto: CreateEmployeeWithDetailsDto,
  ) {
    return this.employeesService.createEmployee(createEmployeeDto, owner);
  }

  @hasRoles(JwtRoles.Owner)
  @Patch('employee/:id')
  updateEmployee(
    @CurrentUser() owner: AuthUser,
    @Param('id') employeeId: string,
    @Body() updateEmployeeDto: UpdateEmployeeDto,
  ) {
    return this.employeesService.updateEmployee(
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
    return this.employeesService.toggleEmployeeStatus(
      owner.id,
      employeeId,
      statusDto,
    );
  }

  @hasRoles(JwtRoles.Owner)
  @Delete('employee/:id')
  deleteEmployee(
    @CurrentUser() owner: AuthUser,
    @Param('id') employeeId: string,
    @Body('reason') reason?: string,
  ) {
    return this.employeesService.deleteEmployee(owner.id, employeeId, reason);
  }

  @hasRoles(JwtRoles.Owner)
  @Patch('employee/:id/restore')
  restoreEmployee(
    @CurrentUser() owner: AuthUser,
    @Param('id') employeeId: string,
  ) {
    return this.employeesService.restoreEmployee(owner.id, employeeId);
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
  googleLogin(
    @Body('token') token: string,
    // Zona del dispositivo (6.01): solo cuenta si es un alta nueva.
    @Body('timezone') timezone?: string,
  ) {
    return this.authService.googleLogin(token, timezone);
  }

  @Public()
  @RateLimit(AUTH_RATE_LIMITS.requestCode)
  @Post('verify/request-code')
  // `isNewUser` (lo sigue enviando la app) ya no cambia nada: nunca crea cuentas (2.19).
  requestVerificationCode(@Body('email') email: string) {
    return this.authService.generateVerificationCode(email);
  }

  @Public()
  @RateLimit(AUTH_RATE_LIMITS.verifyCode)
  @Post('verify/email')
  verifyEmail(@Body('email') email: string, @Body('code') code: string) {
    return this.authService.verifyEmail(email, code);
  }

  @Public()
  @RateLimit(AUTH_RATE_LIMITS.forgotPassword)
  @Post('forgot-password')
  forgotPassword(@Body('email') email: string) {
    return this.authService.generatePasswordResetCode(email);
  }

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

  /** Usuario de la sesión, sin secretos (2.35). */
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.authService.me(user.id);
  }

  @hasRoles(JwtRoles.Owner)
  @Get('employees')
  getEmployees(
    @CurrentUser() owner: AuthUser,
    @Query('includeDeleted') includeDeleted?: string,
  ) {
    const shouldIncludeDeleted = includeDeleted === 'true';
    return this.employeesService.getEmployeesByOwner(
      owner.id,
      shouldIncludeDeleted,
    );
  }

  @hasRoles(JwtRoles.Owner)
  @Get('employee/:id')
  getEmployee(@CurrentUser() owner: AuthUser, @Param('id') employeeId: string) {
    return this.employeesService.getEmployeeByOwner(owner.id, employeeId);
  }

  @hasRoles(JwtRoles.Owner)
  @Get('employees/deleted')
  getDeletedEmployees(@CurrentUser() owner: AuthUser) {
    return this.employeesService.getDeletedEmployeesByOwner(owner.id);
  }

  @hasRoles(JwtRoles.Owner)
  @Get('employees/active')
  getActiveEmployees(@CurrentUser() owner: AuthUser) {
    return this.employeesService.getActiveEmployeesByOwner(owner.id);
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
    return this.employeesService.verifyEmployeeEmail(owner, employeeId, code);
  }
}
