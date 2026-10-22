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
import { Payment } from './entities/payment.entity';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { hasRoles } from '../auth/jwt/has.roles';
import { JwtRoles } from '../auth/jwt/jwt.role';
import { ParseDatePipe } from 'src/common/pipes/parse-date.pipe';
import { AuthUser } from '../auth/interfaces';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @hasRoles(JwtRoles.Owner)
  create(
    @Body() createPaymentDto: CreatePaymentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.paymentsService.create(createPaymentDto, user.id);
  }

  @Post(':id/refund')
  @hasRoles(JwtRoles.Owner)
  refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() refundDto: RefundPaymentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.paymentsService.refund(id, refundDto, user.id);
  }

  @Get()
  @hasRoles(JwtRoles.Owner)
  findAll(@CurrentUser() user: AuthUser) {
    return this.paymentsService.findAll(user.id);
  }

  @Get('stats')
  @hasRoles(JwtRoles.Owner)
  getStats(
    @Query('startDate', ParseDatePipe) startDate: Date,
    @Query('endDate', ParseDatePipe) endDate: Date,
    @CurrentUser() user: AuthUser,
  ) {
    return this.paymentsService.getPaymentStats(startDate, endDate, user.id);
  }

  @Get('employee-stats')
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  async getEmployeeStats(
    @Query('startDate', ParseDatePipe) startDate: Date,
    @Query('endDate', ParseDatePipe) endDate: Date,
    @Query('professionalId') professionalId: string,
    @CurrentUser() user: AuthUser,
  ) {
    const isOnlyEmployee =
      user.roles.includes(JwtRoles.Employee) &&
      !user.roles.includes(JwtRoles.Owner);

    if (isOnlyEmployee) {
      // El owner del empleado sale del AuthUser (2.01), no del token a mano.
      const ownerId = user.ownerId;
      if (!ownerId || ownerId === user.id) {
        throw new BadRequestException(
          'No se puede determinar el propietario del empleado',
        );
      }

      // Empleado ve solo sus propias estadísticas
      return this.paymentsService.getEmployeeStats(
        user.id, // El ID del empleado actual
        startDate,
        endDate,
        ownerId, // El ID del propietario del negocio
      );
    } else {
      // Owner: Necesita un professionalId o devolvemos error
      if (!professionalId) {
        throw new BadRequestException(
          'Se requiere professionalId para consultar estadísticas de un profesional específico',
        );
      }

      console.log(
        'Obteniendo estadísticas para profesional con ID:',
        professionalId,
      );
      console.log('Usuario propietario ID:', user.id);

      return this.paymentsService.getEmployeeStats(
        professionalId,
        startDate,
        endDate,
        user.id,
      );
    }
  }

  @Get('appointment/:id')
  @hasRoles(JwtRoles.Owner)
  findByAppointment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.paymentsService.findByAppointment(id, user.id);
  }

  // Las rutas estáticas van ANTES de ':id' (si no, ':id' + ParseUUIDPipe las captura con 400).
  // Solo Admin: el diagnóstico crea y borra una tabla temporal en la BD.
  @Get('diagnose-timezone')
  @hasRoles(JwtRoles.Admin)
  async diagnoseTimezone() {
    return this.paymentsService.diagnoseTimezoneProblem();
  }

  @Get(':id')
  @hasRoles(JwtRoles.Owner)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.paymentsService.findOne(id, user.id);
  }

  @Get('stats/by-method')
  @hasRoles(JwtRoles.Owner)
  getStatsByMethod(
    @Query('startDate', ParseDatePipe) startDate: Date,
    @Query('endDate', ParseDatePipe) endDate: Date,
    @CurrentUser() user: AuthUser,
  ) {
    return this.paymentsService.getPaymentStatsByMethod(
      startDate,
      endDate,
      user.id,
    );
  }

  @Get('stats/comparison')
  @hasRoles(JwtRoles.Owner)
  getStatsComparison(
    @Query('startDate', ParseDatePipe) startDate: Date,
    @Query('endDate', ParseDatePipe) endDate: Date,
    @CurrentUser() user: AuthUser,
  ) {
    return this.paymentsService.getPaymentStatsComparison(
      startDate,
      endDate,
      user.id,
    );
  }

  @Get('stats/by-service')
  @hasRoles(JwtRoles.Owner)
  getStatsByService(
    @Query('startDate', ParseDatePipe) startDate: Date,
    @Query('endDate', ParseDatePipe) endDate: Date,
    @CurrentUser() user: AuthUser,
  ) {
    return this.paymentsService.getPaymentStatsByService(
      startDate,
      endDate,
      user.id,
    );
  }

  @Get('stats/by-professional')
  @hasRoles(JwtRoles.Owner)
  getStatsByProfessional(
    @Query('startDate', ParseDatePipe) startDate: Date,
    @Query('endDate', ParseDatePipe) endDate: Date,
    @CurrentUser() user: AuthUser,
  ) {
    return this.paymentsService.getPaymentStatsByProfessional(
      startDate,
      endDate,
      user.id,
    );
  }

  @Get('stats/by-client')
  @hasRoles(JwtRoles.Owner)
  getStatsByClient(
    @Query('startDate', ParseDatePipe) startDate: Date,
    @Query('endDate', ParseDatePipe) endDate: Date,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.paymentsService.getPaymentStatsByClient(
      startDate,
      endDate,
      user.id,
      limit,
    );
  }

  @Get('stats/top-clients')
  @hasRoles(JwtRoles.Owner)
  getTopClients(
    @Query('startDate', ParseDatePipe) startDate: Date,
    @Query('endDate', ParseDatePipe) endDate: Date,
    @Query('limit', new DefaultValuePipe(5), ParseIntPipe) limit: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.paymentsService.getTopClients(
      startDate,
      endDate,
      user.id,
      limit,
    );
  }
}
