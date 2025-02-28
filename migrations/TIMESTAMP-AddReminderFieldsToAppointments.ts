// src/database/migrations/TIMESTAMP-AddReminderFieldsToAppointments.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReminderFieldsToAppointments1645678912345
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE appointments 
      ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE appointments 
      DROP COLUMN IF EXISTS reminder_sent,
      DROP COLUMN IF EXISTS reminder_sent_at;
    `);
  }
}
