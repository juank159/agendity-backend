import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from 'src/common/decorators/public.decorator';
import { RateLimit } from 'src/common/decorators/rate-limit.decorator';
import { setRequestTimeZone } from 'src/common/context/request-time-zone';
import {
  CreatePublicBookingDto,
  PublicProfessionalsQueryDto,
  PublicSlotsQueryDto,
} from './dto/public-booking.dto';
import { PUBLIC_BOOKING_LIMITS } from './public-booking-rules';
import { PublicBookingService, PublicBusiness } from './public-booking.service';

/**
 * Agenda pública por link (9.01, D-17). Sin sesión: el negocio sale del
 * `slug`. Las fechas de las respuestas salen con el offset de la zona del
 * negocio (como las rutas con sesión). Throttle por IP.
 */
@ApiTags('Reserva pública')
@Public()
@Controller('public/businesses/:slug')
export class PublicBookingController {
  constructor(private readonly booking: PublicBookingService) {}

  /** Negocio del slug; fija su zona para la respuesta. */
  private async business(slug: string): Promise<PublicBusiness> {
    const business = await this.booking.resolveBusiness(slug);
    setRequestTimeZone(business.timezone);
    return business;
  }

  @Get()
  @RateLimit(PUBLIC_BOOKING_LIMITS.readPerMinute)
  async info(@Param('slug') slug: string) {
    return this.booking.businessInfo(await this.business(slug));
  }

  @Get('services')
  @RateLimit(PUBLIC_BOOKING_LIMITS.readPerMinute)
  async services(@Param('slug') slug: string) {
    return this.booking.services(await this.business(slug));
  }

  @Get('professionals')
  @RateLimit(PUBLIC_BOOKING_LIMITS.readPerMinute)
  async professionals(
    @Param('slug') slug: string,
    @Query() query: PublicProfessionalsQueryDto,
  ) {
    return this.booking.professionals(
      await this.business(slug),
      query.service_ids,
    );
  }

  @Get('available-slots')
  @RateLimit(PUBLIC_BOOKING_LIMITS.readPerMinute)
  async availableSlots(
    @Param('slug') slug: string,
    @Query() query: PublicSlotsQueryDto,
  ) {
    return this.booking.availableSlots(await this.business(slug), query);
  }

  @Post('bookings')
  @HttpCode(201)
  @RateLimit(PUBLIC_BOOKING_LIMITS.createPerMinute)
  async createBooking(
    @Param('slug') slug: string,
    @Body() dto: CreatePublicBookingDto,
  ) {
    return this.booking.createBooking(await this.business(slug), dto);
  }
}
