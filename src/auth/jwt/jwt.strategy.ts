import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';
import { User } from 'src/users/entities/user.entity';
import { AuthUser, JwtPayload, tenantOf } from '../interfaces';
import { accountBlock } from '../account-access';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/constants/error-codes';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('SECRET_KEY_JWT'),
    });
  }

  /**
   * Construye el `AuthUser` y comprueba en CADA petición que la cuenta siga
   * teniendo acceso (2.12): existe, no está borrada ni desactivada y, si es
   * Employee, su negocio existe. Un JWT dura 1 día; sin esta comprobación un
   * empleado desactivado o borrado seguiría entrando hasta que venciera.
   * Coste: una consulta por petición por clave primaria (+ owner y roles), sin
   * caché, para que desactivar tenga efecto inmediato y en todas las instancias.
   * El tenant sale siempre de la BD (`tenantOf`); los roles, del token.
   */
  async validate(payload: JwtPayload): Promise<AuthUser> {
    if (!payload?.id) {
      throw new UnauthorizedException('Token inválido');
    }
    const user = await this.loadAccount(payload.id);
    if (!user) {
      throw new UnauthorizedException('Token inválido');
    }
    if (accountBlock(user)) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        'Tu cuenta ya no tiene acceso. Inicia sesión de nuevo.',
      );
    }
    const tenantId = tenantOf(user);
    return {
      id: payload.id,
      name: payload.name,
      email: payload.email,
      roles: payload.roles ?? [],
      tenantId,
      ownerId: tenantId,
    };
  }

  /** Estado de la cuenta (incluye borrados, para distinguir el motivo). */
  loadAccount(id: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { id },
      relations: { owner: true, roles: true },
      withDeleted: true,
    });
  }
}
