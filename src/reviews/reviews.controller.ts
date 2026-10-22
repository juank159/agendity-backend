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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { hasRoles } from '../auth/jwt/has.roles';
import { JwtRoles } from '../auth/jwt/jwt.role';
import { AuthUser } from '../auth/interfaces';

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
  create(
    @Body() createReviewDto: CreateReviewDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reviewsService.create(createReviewDto, user.id);
  }

  @Get()
  @hasRoles(JwtRoles.Owner)
  @ApiOperation({ summary: 'Obtener todas las reseñas' })
  @ApiResponse({ status: 200, description: 'Lista de reseñas', type: [Review] })
  findAll(@CurrentUser() user: AuthUser) {
    return this.reviewsService.findAll(user.id);
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
    @CurrentUser() user: AuthUser,
  ) {
    return this.reviewsService.findByProfessional(id, user.id);
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
    @CurrentUser() user: AuthUser,
  ) {
    return this.reviewsService.getProfessionalRating(id, user.id);
  }

  @Get(':id')
  @hasRoles(JwtRoles.Owner)
  @ApiOperation({ summary: 'Obtener una reseña por ID' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Reseña encontrada', type: Review })
  @ApiResponse({ status: 404, description: 'Reseña no encontrada' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reviewsService.findOne(id, user.id);
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
    @CurrentUser() user: AuthUser,
  ) {
    return this.reviewsService.update(id, updateReviewDto, user.id);
  }

  @Delete(':id')
  @hasRoles(JwtRoles.Owner)
  @ApiOperation({ summary: 'Eliminar una reseña' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Reseña eliminada' })
  @ApiResponse({ status: 404, description: 'Reseña no encontrada' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reviewsService.remove(id, user.id);
  }
}
