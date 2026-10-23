import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  DefaultValuePipe,
  ParseIntPipe,
  BadRequestException,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Tenant, tenantIdFrom } from '../common/decorators/tenant.decorator';
import { hasRoles } from '../auth/jwt/has.roles';
import { JwtRoles } from '../auth/jwt/jwt.role';
import { ParseDatePipe } from 'src/common/pipes/parse-date.pipe';
import { AuthUser, isOnlyEmployee } from '../auth/interfaces';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @hasRoles(JwtRoles.Owner)
  create(
    @Body() createPaymentDto: CreatePaymentDto,
    @Tenant() tenantId: string,
  ) {
    return this.paymentsService.create(createPaymentDto, tenantId);
  }

  @Post(':id/refund')
  @hasRoles(JwtRoles.Owner)
  refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() refundDto: RefundPaymentDto,
    @Tenant() tenantId: string,
  ) {
    return this.paymentsService.refund(id, refundDto, tenantId);
  }

  @Get()
  @hasRoles(JwtRoles.Owner)
  findAll(@Tenant() tenantId: string) {
    return this.paymentsService.findAll(tenantId);
  }

  @Get('stats')
  @hasRoles(JwtRoles.Owner)
  getStats(
    @Query('startDate', ParseDatePipe) startDate: Date,
    @Query('endDate', ParseDatePipe) endDate: Date,
    @Tenant() tenantId: string,
  ) {
    return this.paymentsService.getPaymentStats(startDate, endDate, tenantId);
  }

  @Get('employee-stats')
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  async getEmployeeStats(
    @Query('startDate', ParseDatePipe) startDate: Date,
    @Query('endDate', ParseDatePipe) endDate: Date,
    @Query('professionalId') professionalId: string,
    @CurrentUser() user: AuthUser,
  ) {
    const tenantId = tenantIdFrom(user);

    if (isOnlyEmployee(user)) {
      // Un empleado sin owner sería su propio tenant: no tiene negocio que consultar.
      if (tenantId === user.id) {
        throw new BadRequestException(
          'No se puede determinar el propietario del empleado',
        );
      }
      // Empleado: solo sus propias estadísticas, dentro de su negocio
      return this.paymentsService.getEmployeeStats(
        user.id,
        startDate,
        endDate,
        tenantId,
      );
    }

    // Owner: necesita un professionalId (los datos se filtran por su negocio)
    if (!professionalId) {
      throw new BadRequestException(
        'Se requiere professionalId para consultar estadísticas de un profesional específico',
      );
    }
    return this.paymentsService.getEmployeeStats(
      professionalId,
      startDate,
      endDate,
      tenantId,
    );
  }

  @Get('appointment/:id')
  @hasRoles(JwtRoles.Owner)
  findByAppointment(
    @Param('id', ParseUUIDPipe) id: string,
    @Tenant() tenantId: string,
  ) {
    return this.paymentsService.findByAppointment(id, tenantId);
  }

  // Las rutas estáticas van ANTES de ':id' (si no, ':id' + ParseUUIDPipe las captura con 400).
  @Get(':id')
  @hasRoles(JwtRoles.Owner)
  findOne(@Param('id', ParseUUIDPipe) id: string, @Tenant() tenantId: string) {
    return this.paymentsService.findOne(id, tenantId);
  }

  @Get('stats/by-method')
  @hasRoles(JwtRoles.Owner)
  getStatsByMethod(
    @Query('startDate', ParseDatePipe) startDate: Date,
    @Query('endDate', ParseDatePipe) endDate: Date,
    @Tenant() tenantId: string,
  ) {
    return this.paymentsService.getPaymentStatsByMethod(
      startDate,
      endDate,
      tenantId,
    );
  }

  @Get('stats/comparison')
  @hasRoles(JwtRoles.Owner)
  getStatsComparison(
    @Query('startDate', ParseDatePipe) startDate: Date,
    @Query('endDate', ParseDatePipe) endDate: Date,
    @Tenant() tenantId: string,
  ) {
    return this.paymentsService.getPaymentStatsComparison(
      startDate,
      endDate,
      tenantId,
    );
  }

  @Get('stats/by-service')
  @hasRoles(JwtRoles.Owner)
  getStatsByService(
    @Query('startDate', ParseDatePipe) startDate: Date,
    @Query('endDate', ParseDatePipe) endDate: Date,
    @Tenant() tenantId: string,
  ) {
    return this.paymentsService.getPaymentStatsByService(
      startDate,
      endDate,
      tenantId,
    );
  }

  @Get('stats/by-professional')
  @hasRoles(JwtRoles.Owner)
  getStatsByProfessional(
    @Query('startDate', ParseDatePipe) startDate: Date,
    @Query('endDate', ParseDatePipe) endDate: Date,
    @Tenant() tenantId: string,
  ) {
    return this.paymentsService.getPaymentStatsByProfessional(
      startDate,
      endDate,
      tenantId,
    );
  }

  @Get('stats/by-client')
  @hasRoles(JwtRoles.Owner)
  getStatsByClient(
    @Query('startDate', ParseDatePipe) startDate: Date,
    @Query('endDate', ParseDatePipe) endDate: Date,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Tenant() tenantId: string,
  ) {
    return this.paymentsService.getPaymentStatsByClient(
      startDate,
      endDate,
      tenantId,
      limit,
    );
  }

  @Get('stats/top-clients')
  @hasRoles(JwtRoles.Owner)
  getTopClients(
    @Query('startDate', ParseDatePipe) startDate: Date,
    @Query('endDate', ParseDatePipe) endDate: Date,
    @Query('limit', new DefaultValuePipe(5), ParseIntPipe) limit: number,
    @Tenant() tenantId: string,
  ) {
    return this.paymentsService.getTopClients(
      startDate,
      endDate,
      tenantId,
      limit,
    );
  }
}
