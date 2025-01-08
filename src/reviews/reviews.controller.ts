import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
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
import { GetUser } from '../common/decorators/get-user.decorator';
import { User } from '../users/entities/user.entity';
import { JwtAuthGuard } from '../auth/jwt/jwt.auth.guard';
import { hasRoles } from '../auth/jwt/has.roles';
import { JwtRoles } from '../auth/jwt/jwt.role';
import { JwtRolesGuard } from '../auth/jwt/jwt.roles.guard';

@ApiTags('Reseñas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, JwtRolesGuard)
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
  create(@Body() createReviewDto: CreateReviewDto, @GetUser() user: User) {
    return this.reviewsService.create(createReviewDto, user.id);
  }

  @Get()
  @hasRoles(JwtRoles.Owner)
  @ApiOperation({ summary: 'Obtener todas las reseñas' })
  @ApiResponse({ status: 200, description: 'Lista de reseñas', type: [Review] })
  findAll(@GetUser() user: User) {
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
    @GetUser() user: User,
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
    @GetUser() user: User,
  ) {
    return this.reviewsService.getProfessionalRating(id, user.id);
  }

  @Get(':id')
  @hasRoles(JwtRoles.Owner)
  @ApiOperation({ summary: 'Obtener una reseña por ID' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Reseña encontrada', type: Review })
  @ApiResponse({ status: 404, description: 'Reseña no encontrada' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: User) {
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
    @GetUser() user: User,
  ) {
    return this.reviewsService.update(id, updateReviewDto, user.id);
  }

  @Delete(':id')
  @hasRoles(JwtRoles.Owner)
  @ApiOperation({ summary: 'Eliminar una reseña' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Reseña eliminada' })
  @ApiResponse({ status: 404, description: 'Reseña no encontrada' })
  remove(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: User) {
    return this.reviewsService.remove(id, user.id);
  }
}
