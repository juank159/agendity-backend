import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Review } from './entities/review.entity';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { AppointmentsService } from '../appointments/appointments.service';
import { AppointmentStatus } from '../appointments/entities/appointment.entity';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(Review)
    private readonly reviewRepository: Repository<Review>,
    private readonly appointmentsService: AppointmentsService,
  ) {}

  async create(createReviewDto: CreateReviewDto): Promise<Review> {
    const appointment = await this.appointmentsService.findOne(createReviewDto.appointment_id);

    // Verificar que la cita esté completada
    if (appointment.status !== AppointmentStatus.COMPLETED) {
      throw new BadRequestException('Solo se pueden dejar reseñas para citas completadas');
    }

    // Verificar si ya existe una reseña para esta cita
    const existingReview = await this.reviewRepository.findOne({
      where: { appointment: { id: appointment.id } }
    });

    if (existingReview) {
      throw new BadRequestException('Ya existe una reseña para esta cita');
    }

    const review = this.reviewRepository.create({
      ...createReviewDto,
      appointment,
      client: appointment.client,
      professional: appointment.professional,
    });

    return await this.reviewRepository.save(review);
  }

  async findAll(): Promise<Review[]> {
    return await this.reviewRepository.find({
      relations: ['appointment', 'client', 'professional'],
    });
  }

  async findByProfessional(professionalId: string): Promise<Review[]> {
    return await this.reviewRepository.find({
      where: { professional: { id: professionalId } },
      relations: ['appointment', 'client', 'professional'],
    });
  }

  async findOne(id: string): Promise<Review> {
    const review = await this.reviewRepository.findOne({
      where: { id },
      relations: ['appointment', 'client', 'professional'],
    });

    if (!review) {
      throw new NotFoundException(`Reseña con ID ${id} no encontrada`);
    }

    return review;
  }

  async update(id: string, updateReviewDto: UpdateReviewDto): Promise<Review> {
    const review = await this.findOne(id);
    Object.assign(review, updateReviewDto);
    return await this.reviewRepository.save(review);
  }

  async remove(id: string): Promise<void> {
    const review = await this.findOne(id);
    await this.reviewRepository.remove(review);
  }

  async getProfessionalRating(professionalId: string): Promise<{ average: number; total: number }> {
    const result = await this.reviewRepository
      .createQueryBuilder('review')
      .where('review.professional.id = :professionalId', { professionalId })
      .select('AVG(review.rating)', 'average')
      .addSelect('COUNT(*)', 'total')
      .getRawOne();

    return {
      average: Number(result.average) || 0,
      total: Number(result.total) || 0,
    };
  }
}