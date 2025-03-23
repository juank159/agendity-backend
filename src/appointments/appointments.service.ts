// import {
//   Injectable,
//   NotFoundException,
//   BadRequestException,
//   InternalServerErrorException,
//   Inject,
//   forwardRef,
// } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository, Not, Between } from 'typeorm';
// import { Appointment } from './entities/appointment.entity';
// import { CreateAppointmentDto } from './dto/create-appointment.dto';
// import { UpdateAppointmentDto } from './dto/update-appointment.dto';
// import { ClientsService } from '../clients/clients.service';
// import { UsersService } from '../users/users.service';
// import { ServicesService } from '../services/services.service';
// import { RELATIONS, RELATION_GROUPS } from './constants/relations.constants';
// import { ErrorHandlerOptions } from './interfaces/error-handler-options.interface';
// import { AppointmentStatus, PaymentStatus } from 'src/common/enums/status.enum';
// import { EventEmitter2 } from '@nestjs/event-emitter';
// import { SubscriptionsService } from 'src/subscriptions/services/subscriptions.service';

// @Injectable()
// export class AppointmentsService {
//   constructor(
//     @InjectRepository(Appointment)
//     private readonly appointmentRepository: Repository<Appointment>,
//     private readonly clientsService: ClientsService,
//     private readonly usersService: UsersService,
//     private readonly servicesService: ServicesService,
//     private readonly eventEmitter: EventEmitter2,
//     @Inject(forwardRef(() => SubscriptionsService))
//     private readonly subscriptionsService: SubscriptionsService,
//   ) {}

//   private handleError(error: any, options: ErrorHandlerOptions): never {
//     console.error(`Error al ${options.operation} ${options.entity}:`, error);

//     if (
//       error instanceof BadRequestException ||
//       error instanceof NotFoundException
//     ) {
//       throw error;
//     }

//     throw new InternalServerErrorException(
//       `Error al ${options.operation} ${options.entity}. Por favor, intenta nuevamente.`,
//     );
//   }

//   async create(
//     createAppointmentDto: CreateAppointmentDto,
//     userId: string,
//   ): Promise<Appointment> {
//     try {
//       console.log('Datos recibidos:', createAppointmentDto);

//       const {
//         client_id,
//         professional_id,
//         service_ids,
//         date,
//         ...appointmentData
//       } = createAppointmentDto;

//       const [client, professional] = await Promise.all([
//         this.clientsService.findOne(client_id, userId),
//         this.usersService.findOne({ id: professional_id }),
//       ]);

//       console.log('Cliente:', client);
//       console.log('Profesional:', professional);

//       if (!client || !professional) {
//         throw new NotFoundException('Cliente o profesional no encontrado');
//       }

//       const services = await Promise.all(
//         service_ids.map((id) => this.servicesService.findOne(id, userId)),
//       );

//       console.log('Servicios:', services);

//       if (services.some((service) => !service)) {
//         throw new NotFoundException('Uno o más servicios no encontrados');
//       }

//       const appointmentDate = new Date(date);
//       console.log('Fecha convertida:', appointmentDate);

//       const existingAppointment = await this.appointmentRepository
//         .createQueryBuilder('appointment')
//         .where('appointment.professional_id = :professionalId', {
//           professionalId: professional_id,
//         })
//         .andWhere('appointment.date = :appointmentDate', {
//           appointmentDate,
//         })
//         .andWhere('appointment.ownerId = :userId', {
//           // Cambiado de owner_id a ownerId
//           userId,
//         })
//         .getOne();

//       if (existingAppointment) {
//         throw new BadRequestException('Horario no disponible');
//       }

//       const appointmentToSave = {
//         ownerId: userId, // Cambiado de owner_id a ownerId
//         professionalId: professional_id, // Cambiado a professionalId para coincidir con la entidad
//         date: new Date(createAppointmentDto.date),
//         total_price: services.reduce(
//           (sum, service) => sum + Number(service.price),
//           0,
//         ),
//         status: AppointmentStatus.PENDING,
//         payment_status: PaymentStatus.PENDING,
//         notes: appointmentData.notes || '',
//         client: client,
//         professional: professional,
//         services: services,
//       };

//       console.log('Objeto a guardar:', appointmentToSave);

//       const savedAppointment =
//         await this.appointmentRepository.save(appointmentToSave);
//       console.log('Cita guardada:', savedAppointment);

//       // Emitir el evento después de guardar la cita
//       this.eventEmitter.emit('appointment.created', savedAppointment);

//       return savedAppointment;
//     } catch (error) {
//       console.error('Error en create:', error);
//       if (
//         error instanceof NotFoundException ||
//         error instanceof BadRequestException
//       ) {
//         throw error;
//       }
//       throw new InternalServerErrorException('Error al crear la cita');
//     }
//   }

//   // async create(
//   //   createAppointmentDto: CreateAppointmentDto,
//   //   userId: string,
//   // ): Promise<Appointment> {
//   //   try {
//   //     console.log('Datos recibidos:', createAppointmentDto);

//   //     // Verificar los límites de suscripción antes de crear la cita
//   //     const subscriptionStatus =
//   //       await this.subscriptionsService.checkSubscriptionStatus(userId);

//   //     if (!subscriptionStatus.canCreateAppointment) {
//   //       throw new BadRequestException(
//   //         subscriptionStatus.message ||
//   //           'No puedes crear más citas. Verifica tu plan de suscripción.',
//   //       );
//   //     }

//   //     const {
//   //       client_id,
//   //       professional_id,
//   //       service_ids,
//   //       date,
//   //       ...appointmentData
//   //     } = createAppointmentDto;

//   //     const [client, professional] = await Promise.all([
//   //       this.clientsService.findOne(client_id, userId),
//   //       this.usersService.findOne({ id: professional_id }),
//   //     ]);

//   //     console.log('Cliente:', client);
//   //     console.log('Profesional:', professional);

//   //     if (!client || !professional) {
//   //       throw new NotFoundException('Cliente o profesional no encontrado');
//   //     }

//   //     const services = await Promise.all(
//   //       service_ids.map((id) => this.servicesService.findOne(id, userId)),
//   //     );

//   //     console.log('Servicios:', services);

//   //     if (services.some((service) => !service)) {
//   //       throw new NotFoundException('Uno o más servicios no encontrados');
//   //     }

//   //     const appointmentDate = new Date(date);
//   //     console.log('Fecha convertida:', appointmentDate);

//   //     const existingAppointment = await this.appointmentRepository
//   //       .createQueryBuilder('appointment')
//   //       .where('appointment.professional_id = :professionalId', {
//   //         professionalId: professional_id,
//   //       })
//   //       .andWhere('appointment.date = :appointmentDate', {
//   //         appointmentDate,
//   //       })
//   //       .andWhere('appointment.ownerId = :userId', {
//   //         userId,
//   //       })
//   //       .getOne();

//   //     if (existingAppointment) {
//   //       throw new BadRequestException('Horario no disponible');
//   //     }

//   //     const appointmentToSave = {
//   //       ownerId: userId,
//   //       professionalId: professional_id,
//   //       date: new Date(createAppointmentDto.date),
//   //       total_price: services.reduce(
//   //         (sum, service) => sum + Number(service.price),
//   //         0,
//   //       ),
//   //       status: AppointmentStatus.PENDING,
//   //       payment_status: PaymentStatus.PENDING,
//   //       notes: appointmentData.notes || '',
//   //       client: client,
//   //       professional: professional,
//   //       services: services,
//   //     };

//   //     console.log('Objeto a guardar:', appointmentToSave);

//   //     // Actualizar el contador de citas de prueba si aplica
//   //     await this.subscriptionsService.updateTrialAppointmentUsage(userId);

//   //     const savedAppointment =
//   //       await this.appointmentRepository.save(appointmentToSave);
//   //     console.log('Cita guardada:', savedAppointment);

//   //     // Emitir el evento después de guardar la cita
//   //     this.eventEmitter.emit('appointment.created', savedAppointment);

//   //     return savedAppointment;
//   //   } catch (error) {
//   //     console.error('Error en create:', error);
//   //     if (
//   //       error instanceof NotFoundException ||
//   //       error instanceof BadRequestException
//   //     ) {
//   //       throw error;
//   //     }
//   //     throw new InternalServerErrorException('Error al crear la cita');
//   //   }
//   // }

//   async findAllByDateRange(
//     userId: string,
//     startDate: Date,
//     endDate: Date,
//   ): Promise<Appointment[]> {
//     try {
//       return await this.appointmentRepository.find({
//         where: {
//           ownerId: userId,
//           date: Between(startDate, endDate),
//         },
//         relations: ['client', 'professional', 'services'], // Aquí también
//         order: {
//           date: 'ASC',
//         },
//       });
//     } catch (error) {
//       this.handleError(error, {
//         entity: 'las citas',
//         operation: 'listar',
//         detail: 'por rango de fechas',
//       });
//     }
//   }

//   async findAll(
//     userId: string,
//     startDate?: Date,
//     endDate?: Date,
//   ): Promise<Appointment[]> {
//     try {
//       if (startDate && endDate) {
//         return this.findAllByDateRange(userId, startDate, endDate);
//       }

//       return await this.appointmentRepository.find({
//         where: { ownerId: userId },
//         relations: ['client', 'professional', 'services'], // Explícitamente definir las relaciones
//         order: {
//           date: 'ASC',
//         },
//       });
//     } catch (error) {
//       this.handleError(error, {
//         entity: 'las citas',
//         operation: 'listar',
//         detail: startDate && endDate ? 'filtrado por fechas' : 'todas',
//       });
//     }
//   }

//   async findOne(id: string, userId: string): Promise<Appointment> {
//     const appointment = await this.appointmentRepository.findOne({
//       where: { id, ownerId: userId },
//       relations: RELATION_GROUPS.default,
//     });

//     if (!appointment) {
//       throw new NotFoundException(`Cita con ID ${id} no encontrada`);
//     }

//     return appointment;
//   }

//   async update(
//     id: string,
//     updateAppointmentDto: UpdateAppointmentDto,
//     userId: string,
//   ): Promise<Appointment> {
//     try {
//       const appointment = await this.findOne(id, userId);

//       if (updateAppointmentDto.date) {
//         const existingAppointment = await this.appointmentRepository
//           .createQueryBuilder('appointment')
//           .where('appointment.professional_id = :professionalId', {
//             professionalId: appointment.professional.id,
//           })
//           .andWhere('appointment.date = :date', {
//             date: updateAppointmentDto.date,
//           })
//           .andWhere('appointment.id != :id', { id })
//           .andWhere('appointment.owner_id = :ownerId', { ownerId: userId })
//           .getOne();

//         if (existingAppointment) {
//           throw new BadRequestException(
//             'El profesional no está disponible en ese horario',
//           );
//         }
//       }

//       const updatedAppointment = await this.appointmentRepository.save({
//         ...appointment,
//         ...updateAppointmentDto,
//       });

//       return updatedAppointment;
//     } catch (error) {
//       this.handleError(error, {
//         entity: 'la cita',
//         operation: 'actualizar',
//       });
//     }
//   }

//   async remove(id: string, userId: string): Promise<void> {
//     try {
//       const appointment = await this.findOne(id, userId);
//       await this.appointmentRepository.remove(appointment);
//     } catch (error) {
//       this.handleError(error, {
//         entity: 'la cita',
//         operation: 'eliminar',
//       });
//     }
//   }

//   async findByProfessionalAndDate(
//     professionalId: string,
//     date: Date,
//     userId: string,
//   ): Promise<Appointment[]> {
//     try {
//       return await this.appointmentRepository.find({
//         where: {
//           professional: { id: professionalId },
//           date,
//           ownerId: userId,
//         },
//         relations: RELATION_GROUPS.minimal,
//       });
//     } catch (error) {
//       this.handleError(error, {
//         entity: 'las citas',
//         operation: 'buscar',
//       });
//     }
//   }
// }

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, Between } from 'typeorm';
import { Appointment } from './entities/appointment.entity';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { ClientsService } from '../clients/clients.service';
import { UsersService } from '../users/users.service';
import { ServicesService } from '../services/services.service';
import { RELATIONS, RELATION_GROUPS } from './constants/relations.constants';
import { ErrorHandlerOptions } from './interfaces/error-handler-options.interface';
import { AppointmentStatus, PaymentStatus } from 'src/common/enums/status.enum';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SubscriptionsService } from 'src/subscriptions/services/subscriptions.service';

@Injectable()
export class AppointmentsService {
  constructor(
    @InjectRepository(Appointment)
    private readonly appointmentRepository: Repository<Appointment>,
    private readonly clientsService: ClientsService,
    private readonly usersService: UsersService,
    private readonly servicesService: ServicesService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => SubscriptionsService))
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  private handleError(error: any, options: ErrorHandlerOptions): never {
    console.error(`Error al ${options.operation} ${options.entity}:`, error);

    if (
      error instanceof BadRequestException ||
      error instanceof NotFoundException
    ) {
      throw error;
    }

    throw new InternalServerErrorException(
      `Error al ${options.operation} ${options.entity}. Por favor, intenta nuevamente.`,
    );
  }

  async create(
    createAppointmentDto: CreateAppointmentDto,
    userId: string,
  ): Promise<Appointment> {
    try {
      console.log('Datos recibidos:', createAppointmentDto);

      const {
        client_id,
        professional_id,
        service_ids,
        date,
        ...appointmentData
      } = createAppointmentDto;

      const [client, professional] = await Promise.all([
        this.clientsService.findOne(client_id, userId),
        this.usersService.findOne({ id: professional_id }),
      ]);

      console.log('Cliente:', client);
      console.log('Profesional:', professional);

      if (!client || !professional) {
        throw new NotFoundException('Cliente o profesional no encontrado');
      }

      const services = await Promise.all(
        service_ids.map((id) => this.servicesService.findOne(id, userId)),
      );

      console.log('Servicios:', services);

      if (services.some((service) => !service)) {
        throw new NotFoundException('Uno o más servicios no encontrados');
      }

      // Verificar disponibilidad con el nuevo método
      const isAvailable = await this.checkProfessionalAvailability(
        professional_id,
        date,
        services,
        userId,
      );

      if (!isAvailable) {
        throw new BadRequestException('Horario no disponible');
      }

      const appointmentToSave = {
        ownerId: userId,
        professionalId: professional_id,
        date: new Date(date),
        total_price: services.reduce(
          (sum, service) => sum + Number(service.price),
          0,
        ),
        status: AppointmentStatus.PENDING,
        payment_status: PaymentStatus.PENDING,
        notes: appointmentData.notes || '',
        client: client,
        professional: professional,
        services: services,
      };

      console.log('Objeto a guardar:', appointmentToSave);

      const savedAppointment =
        await this.appointmentRepository.save(appointmentToSave);
      console.log('Cita guardada:', savedAppointment);

      // Emitir el evento después de guardar la cita
      this.eventEmitter.emit('appointment.created', savedAppointment);

      return savedAppointment;
    } catch (error) {
      console.error('Error en create:', error);
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Error al crear la cita');
    }
  }

  // Nuevo método para verificar disponibilidad del profesional
  async checkProfessionalAvailability(
    professionalId: string,
    appointmentDateTime: string | Date,
    services: any[],
    userId: string,
  ): Promise<boolean> {
    try {
      const appointmentDate = new Date(appointmentDateTime);

      // 1. Calcular la duración total de los servicios solicitados
      const totalDurationMinutes = services.reduce(
        (sum, service) =>
          sum + (service.duration ? parseInt(service.duration) : 30),
        0,
      );

      // 2. Calcular la hora de finalización estimada
      const appointmentEndTime = new Date(appointmentDate);
      appointmentEndTime.setMinutes(
        appointmentEndTime.getMinutes() + totalDurationMinutes,
      );

      console.log(`Verificando disponibilidad:`);
      console.log(`- Profesional: ${professionalId}`);
      console.log(`- Inicio: ${appointmentDate.toISOString()}`);
      console.log(`- Fin estimado: ${appointmentEndTime.toISOString()}`);
      console.log(`- Duración total: ${totalDurationMinutes} minutos`);

      // 3. Buscar todas las citas del profesional para ese día
      const startOfDay = new Date(appointmentDate);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(appointmentDate);
      endOfDay.setHours(23, 59, 59, 999);

      const appointmentsForDay = await this.appointmentRepository.find({
        where: {
          professionalId,
          ownerId: userId,
          date: Between(startOfDay, endOfDay),
        },
        relations: ['services'],
      });

      console.log(`Citas existentes para el día: ${appointmentsForDay.length}`);

      // 4. Verificar si hay solapamiento con alguna cita existente
      for (const existingAppointment of appointmentsForDay) {
        // Calcular duración de la cita existente
        const existingDuration = existingAppointment.services.reduce(
          (sum, service) => sum + (service.duration || 30),
          0,
        );

        // Calcular hora de finalización de la cita existente
        const existingStartTime = new Date(existingAppointment.date);
        const existingEndTime = new Date(existingStartTime);
        existingEndTime.setMinutes(
          existingEndTime.getMinutes() + existingDuration,
        );

        console.log(`Comparando con cita existente:`);
        console.log(`- ID: ${existingAppointment.id}`);
        console.log(`- Inicio: ${existingStartTime.toISOString()}`);
        console.log(`- Fin: ${existingEndTime.toISOString()}`);

        // Verificar solapamiento
        const hasOverlap =
          // Caso 1: La nueva cita comienza durante una cita existente
          (appointmentDate >= existingStartTime &&
            appointmentDate < existingEndTime) ||
          // Caso 2: La nueva cita termina durante una cita existente
          (appointmentEndTime > existingStartTime &&
            appointmentEndTime <= existingEndTime) ||
          // Caso 3: La nueva cita contiene completamente una cita existente
          (appointmentDate <= existingStartTime &&
            appointmentEndTime >= existingEndTime);

        if (hasOverlap) {
          console.log(`¡Solapamiento detectado!`);
          return false;
        }
      }

      // Si no hay solapamientos, el profesional está disponible
      console.log(`Horario disponible`);
      return true;
    } catch (error) {
      console.error('Error al verificar disponibilidad:', error);
      throw new InternalServerErrorException(
        'Error al verificar disponibilidad',
      );
    }
  }

  // También actualizar el método update para usar la misma validación
  async update(
    id: string,
    updateAppointmentDto: UpdateAppointmentDto,
    userId: string,
  ): Promise<Appointment> {
    try {
      const appointment = await this.findOne(id, userId);

      if (updateAppointmentDto.date || updateAppointmentDto.service_ids) {
        // Si se cambia la fecha o los servicios, verificar disponibilidad
        const date = updateAppointmentDto.date || appointment.date;
        const serviceIds =
          updateAppointmentDto.service_ids ||
          appointment.services.map((s) => s.id);

        // Obtener los servicios actualizados
        const services = await Promise.all(
          serviceIds.map((id) => this.servicesService.findOne(id, userId)),
        );

        // Verificar disponibilidad excluyendo la cita actual
        const isAvailable = await this.checkProfessionalAvailabilityForUpdate(
          appointment.professionalId,
          date,
          services,
          userId,
          id, // Excluir la cita actual de la verificación
        );

        if (!isAvailable) {
          throw new BadRequestException(
            'El profesional no está disponible en ese horario',
          );
        }
      }

      const updatedAppointment = await this.appointmentRepository.save({
        ...appointment,
        ...updateAppointmentDto,
      });

      return updatedAppointment;
    } catch (error) {
      this.handleError(error, {
        entity: 'la cita',
        operation: 'actualizar',
      });
    }
  }

  // Versión de checkProfessionalAvailability que excluye una cita específica (para updates)
  async checkProfessionalAvailabilityForUpdate(
    professionalId: string,
    appointmentDateTime: string | Date,
    services: any[],
    userId: string,
    excludeAppointmentId: string,
  ): Promise<boolean> {
    try {
      const appointmentDate = new Date(appointmentDateTime);

      // Calcular la duración total
      const totalDurationMinutes = services.reduce(
        (sum, service) =>
          sum + (service.duration ? parseInt(service.duration) : 30),
        0,
      );

      // Calcular hora de finalización
      const appointmentEndTime = new Date(appointmentDate);
      appointmentEndTime.setMinutes(
        appointmentEndTime.getMinutes() + totalDurationMinutes,
      );

      // Buscar todas las citas del profesional para ese día, excepto la que estamos actualizando
      const startOfDay = new Date(appointmentDate);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(appointmentDate);
      endOfDay.setHours(23, 59, 59, 999);

      const appointmentsForDay = await this.appointmentRepository.find({
        where: {
          professionalId,
          ownerId: userId,
          date: Between(startOfDay, endOfDay),
          id: Not(excludeAppointmentId), // Excluir la cita actual
        },
        relations: ['services'],
      });

      // Verificar solapamientos
      for (const existingAppointment of appointmentsForDay) {
        const existingDuration = existingAppointment.services.reduce(
          (sum, service) => sum + (service.duration || 30),
          0,
        );

        const existingStartTime = new Date(existingAppointment.date);
        const existingEndTime = new Date(existingStartTime);
        existingEndTime.setMinutes(
          existingEndTime.getMinutes() + existingDuration,
        );

        const hasOverlap =
          (appointmentDate >= existingStartTime &&
            appointmentDate < existingEndTime) ||
          (appointmentEndTime > existingStartTime &&
            appointmentEndTime <= existingEndTime) ||
          (appointmentDate <= existingStartTime &&
            appointmentEndTime >= existingEndTime);

        if (hasOverlap) {
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(
        'Error al verificar disponibilidad para actualización:',
        error,
      );
      throw new InternalServerErrorException(
        'Error al verificar disponibilidad',
      );
    }
  }

  async findAllByDateRange(
    userId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<Appointment[]> {
    try {
      return await this.appointmentRepository.find({
        where: {
          ownerId: userId,
          date: Between(startDate, endDate),
        },
        relations: ['client', 'professional', 'services'],
        order: {
          date: 'ASC',
        },
      });
    } catch (error) {
      this.handleError(error, {
        entity: 'las citas',
        operation: 'listar',
        detail: 'por rango de fechas',
      });
    }
  }

  async findAll(
    userId: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<Appointment[]> {
    try {
      if (startDate && endDate) {
        return this.findAllByDateRange(userId, startDate, endDate);
      }

      return await this.appointmentRepository.find({
        where: { ownerId: userId },
        relations: ['client', 'professional', 'services'],
        order: {
          date: 'ASC',
        },
      });
    } catch (error) {
      this.handleError(error, {
        entity: 'las citas',
        operation: 'listar',
        detail: startDate && endDate ? 'filtrado por fechas' : 'todas',
      });
    }
  }

  async findOne(id: string, userId: string): Promise<Appointment> {
    const appointment = await this.appointmentRepository.findOne({
      where: { id, ownerId: userId },
      relations: RELATION_GROUPS.default,
    });

    if (!appointment) {
      throw new NotFoundException(`Cita con ID ${id} no encontrada`);
    }

    return appointment;
  }

  async remove(id: string, userId: string): Promise<void> {
    try {
      const appointment = await this.findOne(id, userId);
      await this.appointmentRepository.remove(appointment);
    } catch (error) {
      this.handleError(error, {
        entity: 'la cita',
        operation: 'eliminar',
      });
    }
  }

  async findByProfessionalAndDate(
    professionalId: string,
    date: Date,
    userId: string,
  ): Promise<Appointment[]> {
    try {
      return await this.appointmentRepository.find({
        where: {
          professional: { id: professionalId },
          date,
          ownerId: userId,
        },
        relations: RELATION_GROUPS.minimal,
      });
    } catch (error) {
      this.handleError(error, {
        entity: 'las citas',
        operation: 'buscar',
      });
    }
  }
}
