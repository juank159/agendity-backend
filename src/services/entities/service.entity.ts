import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
  ManyToMany,
} from 'typeorm';
import { Category } from '../../categories/entities/category.entity';
import { UserService } from 'src/user-services/entities/user-service.entity';
import { ApiProperty } from '@nestjs/swagger';
import { Appointment } from 'src/appointments/entities/appointment.entity';
import { User } from 'src/users/entities/user.entity';

@Entity('services')
export class Service {
  @ApiProperty({
    description: 'ID único del servicio',
    example: 'e7cd5752-9c12-4d4b-9c9f-3c0b93b9c467',
    uniqueItems: true,
  })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    description: 'ID único del dueño del negocio',
    example: 'e7cd5752-9c12-4d4b-9c9f-3c0b93b9c467',
    uniqueItems: true,
  })
  @Column({ name: 'owner_id', type: 'uuid', nullable: false })
  ownerId: string;

  @ApiProperty({
    description: 'Nombre del servicio',
    example: 'Pestañas pelo a pelo',
    maxLength: 100,
  })
  @Column({ unique: true, type: 'varchar', length: 100 })
  name: string;

  @ApiProperty({
    description: 'Descripción detallada del servicio',
    example: 'Pestañas pelo a pelo tecnica 3D',
    required: false,
    nullable: true,
  })
  @Column({ type: 'text', nullable: true })
  description: string;

  @ApiProperty({
    description: 'Precio del servicio',
    example: 35.99,
    type: 'number',
    format: 'decimal',
    minimum: 0,
  })
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: number;

  @ApiProperty({
    description: 'Tipo de precio del servicio (Fijo o Variable)',
    example: 'Precio fijo',
    enum: ['Precio fijo', 'Precio variable'],
    default: 'Precio fijo',
  })
  @Column({
    type: 'enum',
    enum: ['Precio fijo', 'Precio variable'],
    default: 'Precio fijo',
  })
  priceType: 'Precio fijo' | 'Precio variable';

  @ApiProperty({
    description: 'Duración del servicio en minutos',
    example: 60,
    type: 'integer',
    minimum: 1,
  })
  @Column({ type: 'int' })
  duration: number;

  @ApiProperty({
    description: 'ID de la categoría a la que pertenece el servicio',
    example: 'e7cd5752-9c12-4d4b-9c9f-3c0b93b9c467',
    format: 'uuid',
  })
  @Column({ name: 'category_id' })
  categoryId: string;

  @ApiProperty({
    description: 'Nombre del servicio',
    example: 'Pestañas pelo a pelo',
    maxLength: 100,
  })
  @Column({ type: 'varchar', length: 100 })
  color: string;

  @ApiProperty({
    description: 'URL de la imagen del servicio',
    example: 'https://example.com/imagen.png',
    nullable: true,
  })
  @Column({
    type: 'varchar',
    nullable: true,
  })
  image: string;

  @ApiProperty({
    description: 'Indica si el servicio está disponible para reservas online',
    example: true,
    default: false,
  })
  @Column({ type: 'boolean', default: false })
  onlineBooking: boolean;

  @ApiProperty({
    description: 'Abono requerido para reservar el servicio',
    example: 0,
    default: 0,
  })
  @Column({
    type: 'int',
    default: 0,
  })
  deposit: number;

  @ApiProperty({
    description: 'Estado del servicio',
    example: 'true',
    format: 'boolean',
  })
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @ApiProperty({
    description: 'Información completa de la categoría',
    type: () => Category,
  })
  @ManyToOne(() => Category, (category) => category.services, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'category_id' })
  category: Category;

  @ApiProperty({
    description: 'Fecha de creación del servicio',
    example: '2024-12-13T19:27:28.546Z',
  })
  @Column({
    name: 'created_at',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Fecha de última actualización del servicio',
    example: '2024-12-13T19:27:28.546Z',
  })
  @Column({
    name: 'updated_at',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;

  @ApiProperty({
    description: 'Lista de usuarios que ofrecen este servicio',
    type: () => [UserService],
    isArray: true,
  })
  @ManyToOne(() => User, (user) => user.ownedServices)
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @OneToMany(() => UserService, (userService) => userService.service)
  userServices: UserService[];

  @ManyToMany(() => Appointment, (appointment) => appointment.services)
  appointments: Appointment[];
}
