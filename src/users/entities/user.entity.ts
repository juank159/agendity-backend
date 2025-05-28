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

  @Column({
    type: 'varchar',
    unique: true,
    nullable: false,
  })
  phone: string;

  @Column({
    type: 'varchar',
    nullable: true,
  })
  image: string;

  @Column({
    type: 'varchar',
    nullable: false,
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

  @Column({ nullable: true })
  verification_code: string;

  @Column({ nullable: true })
  reset_password_code: string;

  @Column({ nullable: true })
  reset_password_expires: Date;

  @Column({ nullable: true })
  verification_code_expires: Date;

  // 🆕 NUEVO: Soft Delete - TypeORM maneja esto automáticamente
  @DeleteDateColumn()
  deletedAt?: Date;

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
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  created_at: Date;

  @UpdateDateColumn({
    type: 'timestamp',
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

  canBeScheduled(): boolean {
    return this.isActive && !this.isDeleted();
  }
}
