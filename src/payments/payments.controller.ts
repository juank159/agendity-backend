import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { Payment } from './entities/payment.entity';

@ApiTags('Pagos')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @ApiOperation({ summary: 'Crear un nuevo pago' })
  @ApiResponse({ status: 201, description: 'Pago creado exitosamente', type: Payment })
  create(@Body() createPaymentDto: CreatePaymentDto) {
    return this.paymentsService.create(createPaymentDto);
  }

  @Post(':id/refund')
  @ApiOperation({ summary: 'Procesar reembolso de un pago' })
  @ApiResponse({ status: 200, description: 'Reembolso procesado exitosamente', type: Payment })
  refund(@Param('id') id: string, @Body() refundDto: RefundPaymentDto) {
    return this.paymentsService.refund(id, refundDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtener todos los pagos' })
  @ApiResponse({ status: 200, description: 'Lista de pagos', type: [Payment] })
  findAll() {
    return this.paymentsService.findAll();
  }

  @Get('stats')
  @ApiOperation({ summary: 'Obtener estadísticas de pagos' })
  @ApiResponse({
    status: 200,
    description: 'Estadísticas de pagos',
    schema: {
      properties: {
        total_amount: { type: 'number' },
        payment_count: { type: 'number' },
        average_amount: { type: 'number' }
      }
    }
  })
  getStats(
    @Query('startDate') startDate: Date,
    @Query('endDate') endDate: Date
  ) {
    return this.paymentsService.getPaymentStats(startDate, endDate);
  }

  @Get('appointment/:id')
  @ApiOperation({ summary: 'Obtener pagos de una cita' })
  @ApiResponse({ status: 200, description: 'Pagos de la cita', type: [Payment] })
  findByAppointment(@Param('id') id: string) {
    return this.paymentsService.findByAppointment(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un pago por ID' })
  @ApiResponse({ status: 200, description: 'Pago encontrado', type: Payment })
  findOne(@Param('id') id: string) {
    return this.paymentsService.findOne(id);
  }
}