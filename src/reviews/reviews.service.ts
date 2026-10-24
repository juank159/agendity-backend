import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  HttpException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { Review } from './entities/review.entity';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { AppointmentsService } from '../appointments/appointments.service';
import { RELATION_GROUPS } from './constants/relations.constants';
import { ErrorHandlerOptions } from './interfaces/error-handler-options.interface';
import { ProfessionalRating } from './interfaces/professional-rating.interface';
import { ReviewFindOptions } from './interfaces/review-find-options.interface';
import { AppointmentStatus } from 'src/common/enums/status.enum';

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);
  constructor(
    @InjectRepository(Review)
    private readonly reviewRepository: Repository<Review>,
    private readonly appointmentsService: AppointmentsService,
  ) {}

  /**
   * 2.17: toda `HttpException` (incluidas `ConflictException` y
   * `BusinessException`) y todo error de BD (`QueryFailedError`) salen tal
   * cual al filtro global (22P02 → 400, 23505/23503 → 409); antes solo
   * pasaban 400 y 404 y el resto acababa en 500. Lo demás → 500 sin detalles.
   */
  private handleError(error: any, options: ErrorHandlerOptions): never {
    if (error instanceof HttpException || error instanceof QueryFailedError) {
      throw error;
    }
    this.logger.error(
      `Error al ${options.operation} ${options.entity}: ${error?.message}`,
      error?.stack,
    );
    throw new InternalServerErrorException(
      `Error al ${options.operation} ${options.entity}. Por favor, intenta nuevamente.`,
    );
  }

  private async findReview(options: ReviewFindOptions): Promise<Review> {
    const {
      id,
      professionalId,
      appointmentId,
      ownerId,
      loadRelations = true,
    } = options;

    try {
      const where: any = { ownerId };
      if (id) where.id = id;
      if (professionalId) where['professional'] = { id: professionalId };
      if (appointmentId) where['appointment'] = { id: appointmentId };

      const review = await this.reviewRepository.findOne({
        where,
        relations: loadRelations ? RELATION_GROUPS.default : {},
      });

      if (!review && id) {
        throw new NotFoundException(`Reseña con ID ${id} no encontrada`);
      }

      return review;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.handleError(error, {
        entity: 'la reseña',
        operation: 'buscar',
      });
    }
  }

  private async validateAppointment(appointmentId: string, tenantId: string) {
    const appointment = await this.appointmentsService.findOne(
      appointmentId,
      tenantId,
    );

    if (appointment.status !== AppointmentStatus.COMPLETED) {
      throw new BadRequestException(
        'Solo se pueden dejar reseñas para citas completadas',
      );
    }

    return appointment;
  }

  async create(
    createReviewDto: CreateReviewDto,
    tenantId: string,
  ): Promise<Review> {
    try {
      const appointment = await this.validateAppointment(
        createReviewDto.appointment_id,
        tenantId,
      );

      const existingReview = await this.findReview({
        appointmentId: appointment.id,
        ownerId: tenantId,
        loadRelations: false,
      });

      if (existingReview) {
        throw new BadRequestException('Ya existe una reseña para esta cita');
      }

      const review = this.reviewRepository.create({
        ...createReviewDto,
        appointment,
        client: appointment.client,
        professional: appointment.professional,
        ownerId: tenantId,
      });

      return await this.reviewRepository.save(review);
    } catch (error) {
      this.handleError(error, {
        entity: 'la reseña',
        operation: 'crear',
      });
    }
  }

  async findAll(tenantId: string): Promise<Review[]> {
    try {
      return await this.reviewRepository.find({
        where: { ownerId: tenantId },
        relations: RELATION_GROUPS.default,
      });
    } catch (error) {
      this.handleError(error, {
        entity: 'las reseñas',
        operation: 'listar',
      });
    }
  }

  async findByProfessional(
    professionalId: string,
    tenantId: string,
  ): Promise<Review[]> {
    try {
      return await this.reviewRepository.find({
        where: {
          professional: { id: professionalId },
          ownerId: tenantId,
        },
        relations: RELATION_GROUPS.default,
      });
    } catch (error) {
      this.handleError(error, {
        entity: 'las reseñas',
        operation: 'buscar',
      });
    }
  }

  async findOne(id: string, tenantId: string): Promise<Review> {
    return await this.findReview({ id, ownerId: tenantId });
  }

  async update(
    id: string,
    updateReviewDto: UpdateReviewDto,
    tenantId: string,
  ): Promise<Review> {
    try {
      const review = await this.findReview({ id, ownerId: tenantId });

      const updatedReview = this.reviewRepository.create({
        ...review,
        ...updateReviewDto,
      });

      return await this.reviewRepository.save(updatedReview);
    } catch (error) {
      this.handleError(error, {
        entity: 'la reseña',
        operation: 'actualizar',
      });
    }
  }

  async remove(id: string, tenantId: string): Promise<void> {
    try {
      const review = await this.findReview({ id, ownerId: tenantId });
      await this.reviewRepository.remove(review);
    } catch (error) {
      this.handleError(error, {
        entity: 'la reseña',
        operation: 'eliminar',
      });
    }
  }

  async getProfessionalRating(
    professionalId: string,
    tenantId: string,
  ): Promise<ProfessionalRating> {
    try {
      const result = await this.reviewRepository
        .createQueryBuilder('review')
        .where('review.professional.id = :professionalId', { professionalId })
        .andWhere('review.ownerId = :tenantId', { tenantId })
        .select('AVG(review.rating)', 'average')
        .addSelect('COUNT(*)', 'total')
        .getRawOne();

      return {
        average: Number(result.average) || 0,
        total: Number(result.total) || 0,
      };
    } catch (error) {
      this.handleError(error, {
        entity: 'las reseñas',
        operation: 'buscar',
        detail: 'al calcular calificaciones',
      });
    }
  }
}
