import { User } from "src/users/entities/user.entity";
import { Column, Entity, Generated, ManyToMany, PrimaryColumn } from "typeorm";

@Entity({ name: 'roles' })
export class Role {
    @PrimaryColumn('uuid')
    @Generated('uuid')
    id: string;

    @Column({ unique: true })
    name: string;

    @Column({nullable:true})
    image: string;

    @Column({nullable:true})
    route: string;

    @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
    created_at: Date;
  
    @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
    updated_at: Date;

    @ManyToMany(() => User, user => user.id)
    users: User[];
}
