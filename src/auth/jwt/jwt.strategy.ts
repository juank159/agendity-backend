import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';
import { User } from 'src/users/entities/user.entity';
import { AuthUser, JwtPayload, tenantOf } from '../interfaces';

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
   * Construye el `AuthUser`. Los tokens firmados desde 2.01 traen `tenantId` y
   * `ownerId` (sin consulta). Los anteriores no: su `tenant_id` era otro valor
   * (un uuid aleatorio en el Owner, nulo en el Employee), así que se ignora y el
   * tenant se resuelve en la BD. Si el usuario ya no existe (o está borrado), 401.
   */
  async validate(payload: JwtPayload): Promise<AuthUser> {
    if (!payload?.id) {
      throw new UnauthorizedException('Token inválido');
    }
    const base = {
      id: payload.id,
      name: payload.name,
      email: payload.email,
      roles: payload.roles ?? [],
    };
    if (payload.tenantId && payload.ownerId) {
      return { ...base, tenantId: payload.tenantId, ownerId: payload.ownerId };
    }

    const user = await this.userRepository.findOne({
      where: { id: payload.id },
      relations: ['owner'],
    });
    if (!user) {
      throw new UnauthorizedException('Token inválido');
    }
    const tenantId = tenantOf(user);
    return { ...base, tenantId, ownerId: tenantId };
  }
}
