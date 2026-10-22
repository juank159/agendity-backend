import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { Review } from './entities/review.entity';
import { Tenant } from '../common/decorators/tenant.decorator';
import { hasRoles } from '../auth/jwt/has.roles';
import { JwtRoles } from '../auth/jwt/jwt.role';

@ApiTags('Reseñas')
@ApiBearerAuth()
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post()
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  @ApiOperation({ summary: 'Crear una nueva reseña' })
  @ApiResponse({
    status: 201,
    description: 'Reseña creada exitosamente',
    type: Review,
  })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos o cita no completada',
  })
  @ApiResponse({ status: 404, description: 'Cita no encontrada' })
  create(@Body() createReviewDto: CreateReviewDto, @Tenant() tenantId: string) {
    return this.reviewsService.create(createReviewDto, tenantId);
  }

  @Get()
  @hasRoles(JwtRoles.Owner)
  @ApiOperation({ summary: 'Obtener todas las reseñas' })
  @ApiResponse({ status: 200, description: 'Lista de reseñas', type: [Review] })
  findAll(@Tenant() tenantId: string) {
    return this.reviewsService.findAll(tenantId);
  }

  @Get('professional/:id')
  @hasRoles(JwtRoles.Owner)
  @ApiOperation({ summary: 'Obtener reseñas de un profesional' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Reseñas del profesional',
    type: [Review],
  })
  @ApiResponse({ status: 404, description: 'Profesional no encontrado' })
  findByProfessional(
    @Param('id', ParseUUIDPipe) id: string,
    @Tenant() tenantId: string,
  ) {
    return this.reviewsService.findByProfessional(id, tenantId);
  }

  @Get('professional/:id/rating')
  @hasRoles(JwtRoles.Owner)
  @ApiOperation({ summary: 'Obtener calificación promedio de un profesional' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Calificación promedio y total de reseñas',
    schema: {
      properties: {
        average: { type: 'number' },
        total: { type: 'number' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Profesional no encontrado' })
  getProfessionalRating(
    @Param('id', ParseUUIDPipe) id: string,
    @Tenant() tenantId: string,
  ) {
    return this.reviewsService.getProfessionalRating(id, tenantId);
  }

  @Get(':id')
  @hasRoles(JwtRoles.Owner)
  @ApiOperation({ summary: 'Obtener una reseña por ID' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Reseña encontrada', type: Review })
  @ApiResponse({ status: 404, description: 'Reseña no encontrada' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @Tenant() tenantId: string) {
    return this.reviewsService.findOne(id, tenantId);
  }

  @Patch(':id')
  @hasRoles(JwtRoles.Owner)
  @ApiOperation({ summary: 'Actualizar una reseña' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Reseña actualizada', type: Review })
  @ApiResponse({ status: 404, description: 'Reseña no encontrada' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateReviewDto: UpdateReviewDto,
    @Tenant() tenantId: string,
  ) {
    return this.reviewsService.update(id, updateReviewDto, tenantId);
  }

  @Delete(':id')
  @hasRoles(JwtRoles.Owner)
  @ApiOperation({ summary: 'Eliminar una reseña' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Reseña eliminada' })
  @ApiResponse({ status: 404, description: 'Reseña no encontrada' })
  remove(@Param('id', ParseUUIDPipe) id: string, @Tenant() tenantId: string) {
    return this.reviewsService.remove(id, tenantId);
  }
}
