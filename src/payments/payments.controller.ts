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
  Req,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { Payment } from './entities/payment.entity';
import { GetUser } from '../common/decorators/get-user.decorator';
import { User } from '../users/entities/user.entity';
import { hasRoles } from '../auth/jwt/has.roles';
import { JwtRoles } from '../auth/jwt/jwt.role';
import { ParseDatePipe } from 'src/common/pipes/parse-date.pipe';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @hasRoles(JwtRoles.Owner)
  create(@Body() createPaymentDto: CreatePaymentDto, @GetUser() user: User) {
    return this.paymentsService.create(createPaymentDto, user.id);
  }

  @Post(':id/refund')
  @hasRoles(JwtRoles.Owner)
  refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() refundDto: RefundPaymentDto,
    @GetUser() user: User,
  ) {
    return this.paymentsService.refund(id, refundDto, user.id);
  }

  @Get()
  @hasRoles(JwtRoles.Owner)
  findAll(@GetUser() user: User) {
    return this.paymentsService.findAll(user.id);
  }

  @Get('stats')
  @hasRoles(JwtRoles.Owner)
  getStats(
    @Query('startDate', ParseDatePipe) startDate: Date,
    @Query('endDate', ParseDatePipe) endDate: Date,
    @GetUser() user: User,
  ) {
    return this.paymentsService.getPaymentStats(startDate, endDate, user.id);
  }

  @Get('employee-stats')
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  async getEmployeeStats(
    @Query('startDate', ParseDatePipe) startDate: Date,
    @Query('endDate', ParseDatePipe) endDate: Date,
    @Query('professionalId') professionalId: string,
    @GetUser() user: User,
    @Req() request: Request,
  ) {
    // Añadir logs de depuración
    console.log('Usuario accediendo a employee-stats:', {
      id: user.id,
      roles: user.roles?.map((r) => (typeof r === 'string' ? r : r.name)),
      email: user.email,
    });

    // Obtener los roles como strings
    const userRolesAsString = user.roles.map((role) =>
      typeof role === 'string' ? role : role.name || role.toString(),
    );
    console.log('Roles como string:', userRolesAsString);

    // Verificar si el usuario es un empleado (y no es dueño)
    const isOnlyEmployee =
      userRolesAsString.includes(JwtRoles.Employee.toString()) &&
      !userRolesAsString.includes(JwtRoles.Owner.toString());
    console.log('¿Es solo empleado?', isOnlyEmployee);

    if (isOnlyEmployee) {
      // Extraer el owner_id directamente del token JWT
      let ownerId: string | undefined;

      // Obtener el token de la cabecera de autorización
      const authHeader = request.headers['authorization'] as string;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7); // Quitar 'Bearer '
        try {
          // Decodificar el token sin verificar (ya ha sido verificado por el guard)
          const decodedToken = JSON.parse(
            Buffer.from(token.split('.')[1], 'base64').toString(),
          );

          // Extraer owner_id del token
          ownerId = decodedToken.owner_id;
          console.log('Owner ID extraído del token:', ownerId);
        } catch (error) {
          console.error('Error decodificando token:', error);
        }
      }

      console.log('Empleado ID:', user.id);
      console.log('Propietario ID determinado:', ownerId);

      if (!ownerId) {
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
    @GetUser() user: User,
  ) {
    return this.paymentsService.findByAppointment(id, user.id);
  }

  @Get(':id')
  @hasRoles(JwtRoles.Owner)
  findOne(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: User) {
    return this.paymentsService.findOne(id, user.id);
  }

  @Get('stats/by-method')
  @hasRoles(JwtRoles.Owner)
  getStatsByMethod(
    @Query('startDate', ParseDatePipe) startDate: Date,
    @Query('endDate', ParseDatePipe) endDate: Date,
    @GetUser() user: User,
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
    @GetUser() user: User,
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
    @GetUser() user: User,
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
    @GetUser() user: User,
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
    @GetUser() user: User,
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
    @GetUser() user: User,
  ) {
    return this.paymentsService.getTopClients(
      startDate,
      endDate,
      user.id,
      limit,
    );
  }

  @Get('diagnose-timezone')
  async diagnoseTimezone(@GetUser('id') userId: string) {
    return this.paymentsService.diagnoseTimezoneProblem();
  }
}
