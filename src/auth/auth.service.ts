import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CreateAuthDto, CreateEmployeeDto, LoginAuthDto } from './dto';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/users/entities/user.entity';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload } from './interfaces';
import { Role } from 'src/roles/entities/role.entity';
import { v4 as uuid } from 'uuid';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(Role) private readonly roleRepository: Repository<Role>,
    private readonly jwtService: JwtService,
  ) {}

  private async validateUserExists(email: string, phone: string) {
    const existingUser = await this.userRepository.findOne({
      where: [{ email }, { phone }],
    });

    if (existingUser) {
      const duplicatedField =
        existingUser.email === email ? 'email' : 'teléfono';
      const duplicatedValue = duplicatedField === 'email' ? email : phone;
      throw new ConflictException(
        `Ya existe un usuario con el ${duplicatedField}: ${duplicatedValue}`,
      );
    }
  }

  private async getRole(roleName: string): Promise<Role> {
    const role = await this.roleRepository.findOne({
      where: { name: roleName },
    });

    if (!role) {
      throw new InternalServerErrorException(
        `Role ${roleName} no está configurado en la base de datos`,
      );
    }

    return role;
  }

  private async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  private generateToken(user: User): string {
    const payload: JwtPayload = {
      id: user.id,
      name: user.name,
      roles: user.roles.map((role) => role.name),
      tenant_id: user.tenant_id,
      owner_id: user.owner?.id,
    };

    return this.getJwtToken(payload);
  }

  private transformUserResponse(user: User) {
    const { password, ...userData } = user;
    return {
      ...userData,
      roles: userData.roles.map((role) => ({ name: role.name })),
    };
  }

  async createOwner(createAuthDto: CreateAuthDto) {
    try {
      await this.validateUserExists(createAuthDto.email, createAuthDto.phone);

      const ownerRole = await this.getRole('Owner');
      const { password, ...userData } = createAuthDto;

      const newUser = this.userRepository.create({
        ...userData,
        password: await this.hashPassword(password),
        roles: [ownerRole],
        tenant_id: uuid(), // Generar nuevo tenant_id para el owner
      });

      await this.userRepository.save(newUser);

      return {
        user: this.transformUserResponse(newUser),
        token: this.generateToken(newUser),
      };
    } catch (error) {
      throw error;
    }
  }

  async createEmployee(createEmployeeDto: CreateEmployeeDto, owner: User) {
    try {
      await this.validateUserExists(
        createEmployeeDto.email,
        createEmployeeDto.phone,
      );

      const employeeRole = await this.getRole('Employee');
      const { password, ...userData } = createEmployeeDto;

      const newEmployee = this.userRepository.create({
        ...userData,
        password: await this.hashPassword(password),
        roles: [employeeRole],
        owner: owner,
        tenant_id: owner.tenant_id, // Usar el tenant_id del owner
      });

      await this.userRepository.save(newEmployee);

      return {
        user: this.transformUserResponse(newEmployee),
        token: this.generateToken(newEmployee),
      };
    } catch (error) {
      throw error;
    }
  }

  async login(loginAuthDto: LoginAuthDto) {
    try {
      const { email, password } = loginAuthDto;
      const user = await this.userRepository.findOne({
        where: { email },
        relations: ['roles', 'owner'],
      });

      if (!user || !(await bcrypt.compare(password, user.password))) {
        throw new UnauthorizedException('Credenciales inválidas');
      }

      return {
        user: this.transformUserResponse(user),
        token: this.generateToken(user),
      };
    } catch (error) {
      throw error;
    }
  }

  async getEmployeesByOwner(ownerId: string) {
    return await this.userRepository.find({
      where: { owner: { id: ownerId } },
      relations: ['roles'],
    });
  }

  async getEmployeeByOwner(ownerId: string, employeeId: string) {
    const employee = await this.userRepository.findOne({
      where: {
        id: employeeId,
        owner: { id: ownerId },
      },
      relations: ['roles'],
    });

    if (!employee) {
      throw new NotFoundException('Empleado no encontrado');
    }

    return employee;
  }

  private getJwtToken(payload: JwtPayload): string {
    return this.jwtService.sign(payload);
  }
}
