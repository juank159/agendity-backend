// src/migrations/1708024000000-create-appointment-services.ts

import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
} from 'typeorm';

export class CreateAppointmentServices1708024000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Crear la tabla intermedia
    await queryRunner.createTable(
      new Table({
        name: 'appointment_services',
        columns: [
          {
            name: 'appointment_id',
            type: 'uuid',
          },
          {
            name: 'service_id',
            type: 'uuid',
          },
          {
            name: 'created_at',
            type: 'timestamp with time zone',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
    );

    // Añadir las claves foráneas
    await queryRunner.createForeignKey(
      'appointment_services',
      new TableForeignKey({
        columnNames: ['appointment_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'appointments',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'appointment_services',
      new TableForeignKey({
        columnNames: ['service_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'services',
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('appointment_services');
    const foreignKeys = table?.foreignKeys;
    if (foreignKeys) {
      for (const foreignKey of foreignKeys) {
        await queryRunner.dropForeignKey('appointment_services', foreignKey);
      }
    }
    await queryRunner.dropTable('appointment_services');
  }
}
