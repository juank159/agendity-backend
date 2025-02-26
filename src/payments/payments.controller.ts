// import {
//   Controller,
//   Get,
//   Post,
//   Body,
//   Param,
//   Query,
//   UseGuards,
//   ParseUUIDPipe,
// } from '@nestjs/common';
// import {
//   ApiTags,
//   ApiOperation,
//   ApiResponse,
//   ApiBearerAuth,
//   ApiParam,
//   ApiQuery,
// } from '@nestjs/swagger';
// import { PaymentsService } from './payments.service';
// import { CreatePaymentDto } from './dto/create-payment.dto';
// import { RefundPaymentDto } from './dto/refund-payment.dto';
// import { Payment } from './entities/payment.entity';
// import { GetUser } from '../common/decorators/get-user.decorator';
// import { User } from '../users/entities/user.entity';
// import { JwtAuthGuard } from '../auth/jwt/jwt.auth.guard';
// import { hasRoles } from '../auth/jwt/has.roles';
// import { JwtRoles } from '../auth/jwt/jwt.role';
// import { JwtRolesGuard } from '../auth/jwt/jwt.roles.guard';
// import { ParseDatePipe } from 'src/common/pipes/parse-date.pipe';

// @ApiTags('Pagos')
// @ApiBearerAuth()
// @UseGuards(JwtAuthGuard, JwtRolesGuard)
// @Controller('payments')
// export class PaymentsController {
//   constructor(private readonly paymentsService: PaymentsService) {}

//   @Post()
//   @hasRoles(JwtRoles.Owner)
//   @ApiOperation({ summary: 'Crear un nuevo pago' })
//   @ApiResponse({
//     status: 201,
//     description: 'Pago creado exitosamente',
//     type: Payment,
//   })
//   @ApiResponse({ status: 400, description: 'Ya existe un pago para esta cita' })
//   @ApiResponse({ status: 404, description: 'Cita no encontrada' })
//   create(@Body() createPaymentDto: CreatePaymentDto, @GetUser() user: User) {
//     return this.paymentsService.create(createPaymentDto, user.id);
//   }

//   @Post(':id/refund')
//   @hasRoles(JwtRoles.Owner)
//   @ApiOperation({ summary: 'Procesar reembolso de un pago' })
//   @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
//   @ApiResponse({
//     status: 200,
//     description: 'Reembolso procesado exitosamente',
//     type: Payment,
//   })
//   @ApiResponse({
//     status: 400,
//     description: 'Monto de reembolso inválido o pago no reembolsable',
//   })
//   @ApiResponse({ status: 404, description: 'Pago no encontrado' })
//   refund(
//     @Param('id', ParseUUIDPipe) id: string,
//     @Body() refundDto: RefundPaymentDto,
//     @GetUser() user: User,
//   ) {
//     return this.paymentsService.refund(id, refundDto, user.id);
//   }

//   @Get()
//   @hasRoles(JwtRoles.Owner)
//   @ApiOperation({ summary: 'Obtener todos los pagos' })
//   @ApiResponse({ status: 200, description: 'Lista de pagos', type: [Payment] })
//   findAll(@GetUser() user: User) {
//     return this.paymentsService.findAll(user.id);
//   }

//   @Get('stats')
//   @hasRoles(JwtRoles.Owner)
//   @ApiOperation({ summary: 'Obtener estadísticas de pagos' })
//   @ApiQuery({ name: 'startDate', type: 'string', format: 'date' })
//   @ApiQuery({ name: 'endDate', type: 'string', format: 'date' })
//   @ApiResponse({
//     status: 200,
//     description: 'Estadísticas de pagos',
//     schema: {
//       properties: {
//         total_amount: { type: 'number' },
//         payment_count: { type: 'number' },
//         average_amount: { type: 'number' },
//       },
//     },
//   })
//   getStats(
//     @Query('startDate', ParseDatePipe) startDate: Date,
//     @Query('endDate', ParseDatePipe) endDate: Date,
//     @GetUser() user: User,
//   ) {
//     return this.paymentsService.getPaymentStats(startDate, endDate, user.id);
//   }

//   @Get('appointment/:id')
//   @hasRoles(JwtRoles.Owner)
//   @ApiOperation({ summary: 'Obtener pagos de una cita' })
//   @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
//   @ApiResponse({
//     status: 200,
//     description: 'Pagos de la cita',
//     type: [Payment],
//   })
//   @ApiResponse({ status: 404, description: 'Cita no encontrada' })
//   findByAppointment(
//     @Param('id', ParseUUIDPipe) id: string,
//     @GetUser() user: User,
//   ) {
//     return this.paymentsService.findByAppointment(id, user.id);
//   }

//   @Get(':id')
//   @hasRoles(JwtRoles.Owner)
//   @ApiOperation({ summary: 'Obtener un pago por ID' })
//   @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
//   @ApiResponse({ status: 200, description: 'Pago encontrado', type: Payment })
//   @ApiResponse({ status: 404, description: 'Pago no encontrado' })
//   findOne(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: User) {
//     return this.paymentsService.findOne(id, user.id);
//   }
// }

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { Payment } from './entities/payment.entity';
import { GetUser } from '../common/decorators/get-user.decorator';
import { User } from '../users/entities/user.entity';
import { JwtAuthGuard } from '../auth/jwt/jwt.auth.guard';
import { hasRoles } from '../auth/jwt/has.roles';
import { JwtRoles } from '../auth/jwt/jwt.role';
import { JwtRolesGuard } from '../auth/jwt/jwt.roles.guard';
import { ParseDatePipe } from 'src/common/pipes/parse-date.pipe';

@UseGuards(JwtAuthGuard, JwtRolesGuard)
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
}
