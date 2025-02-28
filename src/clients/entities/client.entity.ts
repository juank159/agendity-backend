// import {
//   Column,
//   CreateDateColumn,
//   Entity,
//   OneToMany,
//   ManyToOne,
//   JoinColumn,
//   PrimaryGeneratedColumn,
//   UpdateDateColumn,
// } from 'typeorm';
// import { Appointment } from '../../appointments/entities/appointment.entity';
// import { Review } from '../../reviews/entities/review.entity';
// import { User } from '../../users/entities/user.entity';

// @Entity('clients')
// export class Client {
//   @PrimaryGeneratedColumn('uuid')
//   id: string;

//   @Column('text')
//   name: string;

//   @Column('text')
//   lastname: string;

//   @Column('text')
//   email: string;

//   @Column('text', { unique: true })
//   phone: string;

//   @Column('text', { nullable: true })
//   image?: string;

//   @Column('text', { nullable: true })
//   address?: string;

//   @Column('uuid', { name: 'owner_id' })
//   ownerId: string;

//   @Column('boolean', { default: false })
//   isFromDevice: boolean;

//   @Column('text', { nullable: true })
//   deviceContactId?: string;

//   @Column('timestamptz', { nullable: true })
//   lastVisit?: Date;

//   @Column('boolean', { default: true })
//   isActive: boolean;

//   @Column('text', { nullable: true })
//   notes?: string;

//   @Column('timestamptz', { nullable: true })
//   birthday?: Date;

//   @Column('boolean', { default: false })
//   showNotes: boolean;

//   @CreateDateColumn({
//     type: 'timestamptz',
//     default: () => 'CURRENT_TIMESTAMP',
//   })
//   created_at: Date;

//   @UpdateDateColumn({
//     type: 'timestamptz',
//     default: () => 'CURRENT_TIMESTAMP',
//   })
//   updated_at: Date;

//   // Relaciones
//   @ManyToOne(() => User, (user) => user.clients)
//   @JoinColumn({ name: 'owner_id' })
//   owner: User;

//   @OneToMany(() => Appointment, (appointment) => appointment.client)
//   appointments: Appointment[];

//   @OneToMany(() => Review, (review) => review.client)
//   reviews: Review[];
// }

import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  ManyToOne,
  JoinColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  BeforeInsert,
  BeforeUpdate,
} from 'typeorm';
import { Appointment } from '../../appointments/entities/appointment.entity';
import { Review } from '../../reviews/entities/review.entity';
import { User } from '../../users/entities/user.entity';

@Entity('clients')
export class Client {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('text')
  name: string;

  @Column('text')
  lastname: string;

  @Column('text')
  email: string;

  @Column('text', { unique: true })
  phone: string;

  // Nuevo campo para el código de país
  @Column('text', { default: '+57' }) // Valor predeterminado para Colombia
  countryCode: string;

  // Nuevo campo para preferencia de notificaciones
  @Column('boolean', { default: true })
  enableWhatsAppNotifications: boolean;

  @Column('text', { nullable: true })
  image?: string;

  @Column('text', { nullable: true })
  address?: string;

  @Column('uuid', { name: 'owner_id' })
  ownerId: string;

  @Column('boolean', { default: false })
  isFromDevice: boolean;

  @Column('text', { nullable: true })
  deviceContactId?: string;

  @Column('timestamptz', { nullable: true })
  lastVisit?: Date;

  @Column('boolean', { default: true })
  isActive: boolean;

  @Column('text', { nullable: true })
  notes?: string;

  @Column('timestamptz', { nullable: true })
  birthday?: Date;

  @Column('boolean', { default: false })
  showNotes: boolean;

  @CreateDateColumn({
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  created_at: Date;

  @UpdateDateColumn({
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  updated_at: Date;

  // Método para obtener el número de teléfono completo con formato internacional
  getFormattedPhone(): string {
    // Si el teléfono ya tiene el código de país, lo devolvemos tal cual
    if (this.phone.startsWith('+')) {
      return this.phone;
    }

    // Eliminar cualquier espacio o carácter no numérico del teléfono
    const cleanPhone = this.phone.replace(/\D/g, '');

    // Si el código de país ya tiene '+', lo utilizamos directamente
    if (this.countryCode.startsWith('+')) {
      return `${this.countryCode}${cleanPhone}`;
    }

    // Si no tiene '+', lo añadimos
    return `+${this.countryCode}${cleanPhone}`;
  }

  // Relaciones
  @ManyToOne(() => User, (user) => user.clients)
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @OneToMany(() => Appointment, (appointment) => appointment.client)
  appointments: Appointment[];

  @OneToMany(() => Review, (review) => review.client)
  reviews: Review[];
}
