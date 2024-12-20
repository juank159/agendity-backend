import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { Review } from './entities/review.entity';

@ApiTags('Reseñas')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post()
  @ApiOperation({ summary: 'Crear una nueva reseña' })
  @ApiResponse({ status: 201, description: 'Reseña creada exitosamente', type: Review })
  create(@Body() createReviewDto: CreateReviewDto) {
    return this.reviewsService.create(createReviewDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtener todas las reseñas' })
  @ApiResponse({ status: 200, description: 'Lista de reseñas', type: [Review] })
  findAll() {
    return this.reviewsService.findAll();
  }

  @Get('professional/:id')
  @ApiOperation({ summary: 'Obtener reseñas de un profesional' })
  @ApiResponse({ status: 200, description: 'Reseñas del profesional', type: [Review] })
  findByProfessional(@Param('id') id: string) {
    return this.reviewsService.findByProfessional(id);
  }

  @Get('professional/:id/rating')
  @ApiOperation({ summary: 'Obtener calificación promedio de un profesional' })
  @ApiResponse({ 
    status: 200, 
    description: 'Calificación promedio y total de reseñas',
    schema: {
      properties: {
        average: { type: 'number' },
        total: { type: 'number' }
      }
    }
  })
  getProfessionalRating(@Param('id') id: string) {
    return this.reviewsService.getProfessionalRating(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener una reseña por ID' })
  @ApiResponse({ status: 200, description: 'Reseña encontrada', type: Review })
  findOne(@Param('id') id: string) {
    return this.reviewsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar una reseña' })
  @ApiResponse({ status: 200, description: 'Reseña actualizada', type: Review })
  update(@Param('id') id: string, @Body() updateReviewDto: UpdateReviewDto) {
    return this.reviewsService.update(id, updateReviewDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar una reseña' })
  @ApiResponse({ status: 200, description: 'Reseña eliminada' })
  remove(@Param('id') id: string) {
    return this.reviewsService.remove(id);
  }
}