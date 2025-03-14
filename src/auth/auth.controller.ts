import {
  Controller,
  HttpCode,
  Post,
  Body,
  UseGuards,
  Get,
  Param,
} from '@nestjs/common';

import { CreateAuthDto, CreateEmployeeDto, LoginAuthDto } from './dto';
import { AuthService } from './auth.service';
import { JwtRoles } from './jwt/jwt.role';
import { JwtAuthGuard } from './jwt/jwt.auth.guard';
import { JwtRolesGuard } from './jwt/jwt.roles.guard';
import { hasRoles } from './jwt/has.roles';
import { User } from '../users/entities/user.entity';
import { GetUser } from 'src/common/decorators/get-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register/owner')
  registerOwner(@Body() createAuthDto: CreateAuthDto) {
    return this.authService.createOwner(createAuthDto);
  }

  @hasRoles(JwtRoles.Owner)
  @UseGuards(JwtAuthGuard, JwtRolesGuard)
  @Post('register/employee')
  createEmployee(
    @GetUser() owner: User,
    @Body() createEmployeeDto: CreateEmployeeDto,
  ) {
    return this.authService.createEmployee(createEmployeeDto, owner);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() loginAuthDto: LoginAuthDto) {
    return this.authService.login(loginAuthDto);
  }

  @Post('google')
  @HttpCode(200)
  googleLogin(@Body('token') token: string) {
    return this.authService.googleLogin(token);
  }

  @Post('verify/request-code')
  requestVerificationCode(@Body('email') email: string) {
    return this.authService.generateVerificationCode(email);
  }

  @Post('verify/email')
  verifyEmail(@Body('email') email: string, @Body('code') code: string) {
    return this.authService.verifyEmail(email, code);
  }

  @Post('forgot-password')
  forgotPassword(@Body('email') email: string) {
    return this.authService.generatePasswordResetCode(email);
  }

  @Post('reset-password')
  resetPassword(
    @Body('email') email: string,
    @Body('code') code: string,
    @Body('new_password') newPassword: string,
  ) {
    return this.authService.resetPassword(email, code, newPassword);
  }

  @hasRoles(JwtRoles.Owner)
  @UseGuards(JwtAuthGuard, JwtRolesGuard)
  @Get('employees')
  getEmployees(@GetUser() owner: User) {
    return this.authService.getEmployeesByOwner(owner.id);
  }

  @hasRoles(JwtRoles.Owner)
  @UseGuards(JwtAuthGuard, JwtRolesGuard)
  @Get('employee/:id')
  getEmployee(@GetUser() owner: User, @Param('id') employeeId: string) {
    return this.authService.getEmployeeByOwner(owner.id, employeeId);
  }
}
