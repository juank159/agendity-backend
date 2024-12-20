// import {
//   Entity,
//   PrimaryGeneratedColumn,
//   Column,
//   OneToMany,
//   ManyToOne,
//   JoinColumn,
// } from 'typeorm';
// import { Service } from '../../services/entities/service.entity';
// import { ApiProperty } from '@nestjs/swagger';
// import { User } from 'src/users/entities/user.entity';

// @Entity('categories')
// export class Category {
//   @ApiProperty({
//     description: 'ID único de la categoría',
//     example: 'e7cd5752-9c12-4d4b-9c9f-3c0b93b9c467',
//     uniqueItems: true,
//   })
//   @PrimaryGeneratedColumn('uuid')
//   id: string;

//   @ApiProperty({
//     description: 'ID único del dueño del negocio',
//     example: 'e7cd5752-9c12-4d4b-9c9f-3c0b93b9c467',
//     uniqueItems: true,
//   })
//   @Column({ name: 'owner_id', type: 'uuid', nullable: false })
//   ownerId: string;

//   @ApiProperty({
//     description: 'Nombre de la categoría',
//     example: 'Cejas',
//     maxLength: 100,
//     required: true,
//   })
//   @Column({ type: 'varchar', length: 100 })
//   name: string;

//   @ApiProperty({
//     description: 'Descripción detallada de la categoría',
//     example: 'Cejas Semipermanentes',
//     required: false,
//     nullable: true,
//   })
//   @Column({ type: 'text', nullable: true })
//   description: string;

//   @ApiProperty({
//     description: 'Fecha de creación del registro',
//     example: '2024-12-13T19:27:28.546Z',
//     required: true,
//   })
//   @Column({
//     name: 'created_at',
//     type: 'timestamp',
//     default: () => 'CURRENT_TIMESTAMP',
//   })
//   createdAt: Date;

//   @ApiProperty({
//     description: 'Fecha de última actualización del registro',
//     example: '2024-12-13T19:27:28.546Z',
//     required: true,
//   })
//   @Column({
//     name: 'updated_at',
//     type: 'timestamp',
//     default: () => 'CURRENT_TIMESTAMP',
//     onUpdate: 'CURRENT_TIMESTAMP',
//   })
//   updatedAt: Date;

//   @ApiProperty({
//     description: 'Lista de servicios asociados a esta categoría',
//     type: () => [Service],
//     isArray: true,
//     required: false,
//   })
//   @OneToMany(() => Service, (service) => service.category)
//   services: Service[];

//   @ManyToOne(() => User, (user) => user.categories)
//   @JoinColumn({ name: 'owner_id' })
//   owner: User;
// }

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Service } from '../../services/entities/service.entity';
import { ApiProperty } from '@nestjs/swagger';
import { User } from 'src/users/entities/user.entity';

@Entity('categories')
@Index(['name', 'ownerId'], { unique: true }) // Índice compuesto para unicidad por dueño
export class Category {
  @ApiProperty({
    description: 'ID único de la categoría',
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
    description: 'Nombre de la categoría',
    example: 'Cejas',
    maxLength: 100,
    required: true,
  })
  @Column({
    type: 'varchar',
    length: 100,
    // Ya no necesita unique: true aquí
  })
  name: string;

  @ApiProperty({
    description: 'Descripción detallada de la categoría',
    example: 'Cejas Semipermanentes',
    required: false,
    nullable: true,
  })
  @Column({ type: 'text', nullable: true })
  description: string;

  @ApiProperty({
    description: 'Estado del servicio',
    example: 'true',
    format: 'boolean',
  })
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @ApiProperty({
    description: 'Fecha de creación del registro',
    example: '2024-12-13T19:27:28.546Z',
    required: true,
  })
  @Column({
    name: 'created_at',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Fecha de última actualización del registro',
    example: '2024-12-13T19:27:28.546Z',
    required: true,
  })
  @Column({
    name: 'updated_at',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;

  @ApiProperty({
    description: 'Lista de servicios asociados a esta categoría',
    type: () => [Service],
    isArray: true,
    required: false,
  })
  @OneToMany(() => Service, (service) => service.category)
  services: Service[];

  @ApiProperty({
    description: 'Usuario dueño de la categoría',
    type: () => User,
  })
  @ManyToOne(() => User, (user) => user.categories)
  @JoinColumn({ name: 'owner_id' })
  owner: User;
}
