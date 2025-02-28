// src/database/migrations/YYYYMMDDHHMMSS-AddAppointmentReminders.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAppointmentReminders1656789012345
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE appointments 
      ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS send_reminder BOOLEAN DEFAULT TRUE;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE appointments 
      DROP COLUMN IF EXISTS reminder_sent,
      DROP COLUMN IF EXISTS reminder_sent_at,
      DROP COLUMN IF EXISTS send_reminder;
    `);
  }
}
