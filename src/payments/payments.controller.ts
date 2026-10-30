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
import { PaymentStatsService } from './payment-stats.service';
import { CommissionSettlementService } from './commission-settlement.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Tenant, tenantIdFrom } from '../common/decorators/tenant.decorator';
import { hasRoles } from '../auth/jwt/has.roles';
import { JwtRoles } from '../auth/jwt/jwt.role';
import { QueryDate } from 'src/common/decorators/query-date.decorator';
import { AuthUser, isOnlyEmployee } from '../auth/interfaces';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly paymentStatsService: PaymentStatsService,
    private readonly commissionSettlement: CommissionSettlementService,
  ) {}

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
    @QueryDate('startDate') startDate: Date,
    @QueryDate('endDate') endDate: Date,
    @Tenant() tenantId: string,
  ) {
    return this.paymentStatsService.getPaymentStats(
      startDate,
      endDate,
      tenantId,
    );
  }

  @Get('employee-stats')
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  async getEmployeeStats(
    @QueryDate('startDate') startDate: Date,
    @QueryDate('endDate') endDate: Date,
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
      return this.paymentStatsService.getEmployeeStats(
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
    return this.paymentStatsService.getEmployeeStats(
      professionalId,
      startDate,
      endDate,
      tenantId,
    );
  }

  /**
   * Liquidación de comisiones (8.02, D-16): por profesional, precio de las
   * líneas de las citas COMPLETED del periodo, comisión del profesional y
   * parte del negocio, con el detalle por cita. Owner: todos (o
   * `professionalId`); Employee: solo lo suyo.
   */
  @Get('stats/commissions')
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  getCommissions(
    @QueryDate('startDate') startDate: Date,
    @QueryDate('endDate') endDate: Date,
    @Query('professionalId', new ParseUUIDPipe({ optional: true }))
    professionalId: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.commissionSettlement.settle(
      tenantIdFrom(user),
      startDate,
      endDate,
      {
        professionalId,
        onlyProfessionalId: isOnlyEmployee(user) ? user.id : undefined,
      },
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
    @QueryDate('startDate') startDate: Date,
    @QueryDate('endDate') endDate: Date,
    @Tenant() tenantId: string,
  ) {
    return this.paymentStatsService.getPaymentStatsByMethod(
      startDate,
      endDate,
      tenantId,
    );
  }

  @Get('stats/comparison')
  @hasRoles(JwtRoles.Owner)
  getStatsComparison(
    @QueryDate('startDate') startDate: Date,
    @QueryDate('endDate') endDate: Date,
    @Tenant() tenantId: string,
  ) {
    return this.paymentStatsService.getPaymentStatsComparison(
      startDate,
      endDate,
      tenantId,
    );
  }

  @Get('stats/by-service')
  @hasRoles(JwtRoles.Owner)
  getStatsByService(
    @QueryDate('startDate') startDate: Date,
    @QueryDate('endDate') endDate: Date,
    @Tenant() tenantId: string,
  ) {
    return this.paymentStatsService.getPaymentStatsByService(
      startDate,
      endDate,
      tenantId,
    );
  }

  @Get('stats/by-professional')
  @hasRoles(JwtRoles.Owner)
  getStatsByProfessional(
    @QueryDate('startDate') startDate: Date,
    @QueryDate('endDate') endDate: Date,
    @Tenant() tenantId: string,
  ) {
    return this.paymentStatsService.getPaymentStatsByProfessional(
      startDate,
      endDate,
      tenantId,
    );
  }

  @Get('stats/by-client')
  @hasRoles(JwtRoles.Owner)
  getStatsByClient(
    @QueryDate('startDate') startDate: Date,
    @QueryDate('endDate') endDate: Date,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Tenant() tenantId: string,
  ) {
    return this.paymentStatsService.getPaymentStatsByClient(
      startDate,
      endDate,
      tenantId,
      limit,
    );
  }

  @Get('stats/top-clients')
  @hasRoles(JwtRoles.Owner)
  getTopClients(
    @QueryDate('startDate') startDate: Date,
    @QueryDate('endDate') endDate: Date,
    @Query('limit', new DefaultValuePipe(5), ParseIntPipe) limit: number,
    @Tenant() tenantId: string,
  ) {
    return this.paymentStatsService.getTopClients(
      startDate,
      endDate,
      tenantId,
      limit,
    );
  }
}
