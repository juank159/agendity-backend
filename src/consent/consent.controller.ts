import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { hasRoles } from 'src/auth/jwt/has.roles';
import { JwtRoles } from 'src/auth/jwt/jwt.role';
import { AuthUser } from 'src/auth/interfaces';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { Public } from 'src/common/decorators/public.decorator';
import { RateLimit } from 'src/common/decorators/rate-limit.decorator';
import { Tenant } from 'src/common/decorators/tenant.decorator';
import { ConsentService } from './consent.service';

/** Límite por IP y minuto de la página pública de consentimiento. */
export const CONSENT_RATE_LIMIT = 20;

/**
 * `POST /clients/:id/consent-link` (11.06): Owner y Employee, como editar un
 * cliente. Cliente de otro negocio → 404.
 */
@Controller('clients')
export class ConsentLinkController {
  constructor(private readonly consent: ConsentService) {}

  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  @Post(':id/consent-link')
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Tenant() tenantId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.consent.createLink(id, tenantId, user.id);
  }
}

/**
 * API de la página pública `/consentimiento/:token` (11.06). Sin sesión: la
 * autenticidad la da la firma del token. Throttle por IP.
 */
@Public()
@Controller('public/consent')
export class PublicConsentController {
  constructor(private readonly consent: ConsentService) {}

  @Get(':token')
  @RateLimit(CONSENT_RATE_LIMIT)
  view(@Param('token') token: string) {
    return this.consent.view(token);
  }

  @Post(':token/accept')
  @HttpCode(200)
  @RateLimit(CONSENT_RATE_LIMIT)
  accept(
    @Param('token') token: string,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.consent.accept(token, {
      ip: ip || null,
      userAgent: userAgent ?? null,
    });
  }
}
