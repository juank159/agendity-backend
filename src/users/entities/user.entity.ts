import { Role } from 'src/roles/entities/role.entity';
import { UserService } from 'src/user-services/entities/user-service.entity';
import { Appointment } from 'src/appointments/entities/appointment.entity';
import { Review } from 'src/reviews/entities/review.entity';
import { Schedule } from 'src/schedules/entities/schedule.entity';
import { TimeBlock } from 'src/time-blocks/entities/time-block.entity';
import {
  Column,
  Entity,
  JoinTable,
  ManyToMany,
  OneToMany,
  ManyToOne,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  JoinColumn,
} from 'typeorm';
import { Service } from 'src/services/entities/service.entity';
import { Category } from 'src/categories/entities/category.entity';
import { Client } from 'src/clients/entities/client.entity';
import { Exclude } from 'class-transformer';

/**
 * Columnas de `users` que nunca deben salir en una respuesta HTTP.
 * Tienen `select: false` (no se cargan salvo `addSelect` explícito) y `@Exclude()`
 * para el `ClassSerializerInterceptor` global.
 */
export const USER_SECRET_FIELDS = [
  'password',
  'verification_code',
  'verification_code_expires',
  'reset_password_code',
  'reset_password_expires',
] as const;
export type UserSecretField = (typeof USER_SECRET_FIELDS)[number];

/** Copia plana del usuario sin las columnas secretas (para respuestas armadas a mano). */
export function omitUserSecrets<T extends object>(
  user: T,
): Omit<T, UserSecretField> {
  const copy = { ...user };
  for (const field of USER_SECRET_FIELDS) {
    delete (copy as Record<string, unknown>)[field];
  }
  return copy;
}

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'varchar',
    nullable: false,
    default: '',
  })
  name: string;

  @Column({
    type: 'varchar',
    nullable: false,
    default: '',
  })
  lastname: string;

  @Column({
    type: 'varchar',
    unique: true,
    nullable: false,
  })
  email: string;

  /**
   * Único, pero opcional (2.10): las cuentas de Google y el registro temporal
   * de `verify/request-code` no tienen teléfono → `null` (nunca `''`: el índice
   * único admite varios NULL pero no dos cadenas vacías).
   */
  @Column({
    type: 'varchar',
    unique: true,
    nullable: true,
  })
  phone: string | null;

  @Column({
    type: 'varchar',
    nullable: true,
  })
  image: string;

  @Exclude({ toPlainOnly: true })
  @Column({
    type: 'varchar',
    nullable: false,
    select: false,
  })
  password: string;

  @Column({
    type: 'varchar',
    nullable: true,
    name: 'notification_token',
  })
  notification_token: string;

  // Campo existente para activar/desactivar (login y citas)
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ default: false })
  is_google_account: boolean;

  // Tenant ID para multitenant
  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenant_id: string;

  @Column({ default: false })
  is_email_verified: boolean;

  @Exclude({ toPlainOnly: true })
  @Column({ nullable: true, select: false })
  verification_code: string;

  @Exclude({ toPlainOnly: true })
  @Column({ nullable: true, select: false })
  reset_password_code: string;

  @Exclude({ toPlainOnly: true })
  @Column({ type: 'timestamptz', nullable: true, select: false })
  reset_password_expires: Date;

  @Exclude({ toPlainOnly: true })
  @Column({ type: 'timestamptz', nullable: true, select: false })
  verification_code_expires: Date;

  // 🆕 NUEVO: Soft Delete - TypeORM maneja esto automáticamente
  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt?: Date;

  /**
   * Comisión general del profesional (8.02, D-16): % de cada servicio que
   * atiende, salvo excepción por servicio (`user_services.commissionPercentage`).
   * 0 a 100; por defecto 0 (el Owner no la usa: todo es del negocio).
   */
  @Column({
    name: 'commission_percentage',
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 0,
  })
  commission_percentage: string;

  // 🆕 NUEVO: Razón de la eliminación (opcional)
  @Column({ nullable: true })
  deletionReason?: string;

  // 🆕 NUEVO: Usuario que eliminó (para auditoría)
  @Column({ nullable: true })
  deletedBy?: string;

  // Relación Owner-Employee
  @ManyToOne(() => User, (user) => user.employees, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @OneToMany(() => User, (user) => user.owner)
  employees: User[];

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

  @JoinTable({
    name: 'user_has_roles',
    joinColumn: {
      name: 'user_id',
      referencedColumnName: 'id',
    },
    inverseJoinColumn: {
      name: 'role_id',
      referencedColumnName: 'id',
    },
  })
  @ManyToMany(() => Role, (role) => role.users, {
    cascade: true,
  })
  roles: Role[];

  // Relaciones con otras entidades del negocio
  @OneToMany(() => Category, (category) => category.owner)
  categories: Category[];

  @OneToMany(() => Service, (service) => service.owner)
  ownedServices: Service[];

  @OneToMany(() => UserService, (userService) => userService.user)
  userServices: UserService[];

  @OneToMany(() => Appointment, (appointment) => appointment.professional)
  appointments: Appointment[];

  @OneToMany(() => Review, (review) => review.professional)
  reviews: Review[];

  @OneToMany(() => Schedule, (schedule) => schedule.user)
  schedules: Schedule[];

  @OneToMany(() => TimeBlock, (timeBlock) => timeBlock.user)
  timeBlocks: TimeBlock[];

  @OneToMany(() => Client, (client) => client.owner)
  clients: Client[];

  // Métodos auxiliares existentes
  isOwner(): boolean {
    return this.roles?.some((role) => role.name === 'Owner');
  }

  isEmployee(): boolean {
    return this.roles?.some((role) => role.name === 'Employee');
  }

  isAdmin(): boolean {
    return this.roles?.some((role) => role.name === 'Admin');
  }

  belongsToOwner(ownerId: string): boolean {
    return this.owner?.id === ownerId;
  }

  // 🆕 NUEVOS: Métodos auxiliares para soft delete
  isDeleted(): boolean {
    return !!this.deletedAt;
  }

  isActiveEmployee(): boolean {
    return this.isEmployee() && this.isActive && !this.isDeleted();
  }

  canLogin(): boolean {
    return this.isActive && !this.isDeleted();
  }
}
