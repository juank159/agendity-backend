import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migración inicial (tarea 1.08): crea el esquema completo tal como estaba el
 * 2026-10-21 (19 entidades), generado con `migration:generate` contra una base
 * vacía.
 *
 * La base de desarrollo `ecommerce` ya tenía este esquema (creado con
 * `synchronize`): ahí NO se ejecuta, se registra como aplicada en la tabla
 * `migrations` (línea base). Solo corre en bases nuevas (staging, producción,
 * una base vacía de pruebas).
 */

export class InitialSchema1792633336884 implements MigrationInterface {
  name = 'InitialSchema1792633336884';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Las PK usan uuid_generate_v4(). El driver de TypeORM la crea al conectar,
    // pero la migración no debe depender de eso.
    await queryRunner.query(`
            CREATE EXTENSION IF NOT EXISTS "uuid-ossp"
        `);
    await queryRunner.query(`
            CREATE TABLE "roles" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "name" character varying NOT NULL,
                "image" character varying,
                "route" character varying,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_648e3f5447f725579d7d4ffdfb7" UNIQUE ("name"),
                CONSTRAINT "PK_c1433d71a4838793a49dcad46ab" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "categories" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "owner_id" uuid NOT NULL,
                "name" character varying(100) NOT NULL,
                "description" text,
                "isActive" boolean NOT NULL DEFAULT true,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_24dbc6126a28ff948da33e97d3b" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_f33348d6b05ccbb1d6a06afda5" ON "categories" ("name", "owner_id")
        `);
    await queryRunner.query(`
            CREATE TABLE "reviews" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "owner_id" uuid NOT NULL,
                "rating" integer NOT NULL,
                "comment" text NOT NULL,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "appointmentId" uuid,
                "clientId" uuid,
                "professionalId" uuid,
                CONSTRAINT "PK_231ae565c273ee700b283f15c1d" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "clients" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "name" text NOT NULL,
                "lastname" text NOT NULL,
                "email" text NOT NULL,
                "phone" text NOT NULL,
                "countryCode" text NOT NULL DEFAULT '+57',
                "enableWhatsAppNotifications" boolean NOT NULL DEFAULT true,
                "image" text,
                "address" text,
                "owner_id" uuid NOT NULL,
                "isFromDevice" boolean NOT NULL DEFAULT false,
                "deviceContactId" text,
                "lastVisit" TIMESTAMP WITH TIME ZONE,
                "isActive" boolean NOT NULL DEFAULT true,
                "notes" text,
                "birthday" TIMESTAMP WITH TIME ZONE,
                "showNotes" boolean NOT NULL DEFAULT false,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_f1ab7cf3a5714dbc6bb4e1c28a4" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_7fa45fac84fcfdd07ac1c5ae13" ON "clients" ("phone", "owner_id")
        `);
    await queryRunner.query(`
            CREATE TABLE "time_block" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "start_datetime" TIMESTAMP NOT NULL,
                "end_datetime" TIMESTAMP NOT NULL,
                "notes" character varying,
                "userId" uuid,
                "appointmentId" uuid,
                CONSTRAINT "PK_1c6bb03fe5b1501673a5d9acb18" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "custom_payment_methods" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "owner_id" uuid NOT NULL,
                "name" character varying(100) NOT NULL,
                "description" character varying(255),
                "icon" character varying,
                "isActive" boolean NOT NULL DEFAULT true,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_cc9a305e29c3dd1bd62f71f21c0" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."payments_payment_method_enum" AS ENUM(
                'CASH',
                'CREDIT_CARD',
                'DEBIT_CARD',
                'TRANSFER',
                'ONLINE'
            )
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."payments_status_enum" AS ENUM(
                'PENDING',
                'COMPLETED',
                'FAILED',
                'REFUNDED',
                'CANCELLED'
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "payments" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "owner_id" uuid NOT NULL,
                "amount" numeric(10, 2) NOT NULL,
                "payment_method" "public"."payments_payment_method_enum",
                "custom_payment_method_id" uuid,
                "status" "public"."payments_status_enum" NOT NULL DEFAULT 'PENDING',
                "transaction_id" text,
                "payment_details" jsonb,
                "refund_reason" text,
                "refund_amount" numeric(10, 2),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "appointmentId" uuid,
                CONSTRAINT "PK_197ab7af18c93fbb0c9b28b4a59" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."appointments_status_enum" AS ENUM('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED')
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."appointments_payment_status_enum" AS ENUM(
                'PENDING',
                'COMPLETED',
                'FAILED',
                'REFUNDED',
                'CANCELLED'
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "appointments" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "owner_id" uuid NOT NULL,
                "professional_id" uuid NOT NULL,
                "date" TIMESTAMP NOT NULL,
                "status" "public"."appointments_status_enum" NOT NULL DEFAULT 'PENDING',
                "payment_status" "public"."appointments_payment_status_enum" NOT NULL DEFAULT 'PENDING',
                "total_price" numeric NOT NULL,
                "notes" text,
                "cancellation_reason" text,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                "reminder_sent" boolean NOT NULL DEFAULT false,
                "reminder_sent_at" TIMESTAMP WITH TIME ZONE,
                "send_reminder" boolean NOT NULL DEFAULT true,
                "clientId" uuid,
                CONSTRAINT "PK_4a437a9a27e948726b8bb3e36ad" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."services_pricetype_enum" AS ENUM('Precio fijo', 'Precio variable')
        `);
    await queryRunner.query(`
            CREATE TABLE "services" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "owner_id" uuid NOT NULL,
                "name" character varying(100) NOT NULL,
                "description" text,
                "price" numeric(10, 2) NOT NULL,
                "priceType" "public"."services_pricetype_enum" NOT NULL DEFAULT 'Precio fijo',
                "duration" integer NOT NULL,
                "category_id" uuid NOT NULL,
                "color" character varying(100) NOT NULL,
                "image" character varying,
                "onlineBooking" boolean NOT NULL DEFAULT false,
                "deposit" integer NOT NULL DEFAULT '0',
                "isActive" boolean NOT NULL DEFAULT true,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_019d74f7abcdcb5a0113010cb03" UNIQUE ("name"),
                CONSTRAINT "PK_ba2d347a3168a296416c6c5ccb2" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "user_services" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "user_id" uuid NOT NULL,
                "service_id" uuid NOT NULL,
                "customPrice" numeric(10, 2),
                "commissionPercentage" numeric(5, 2) NOT NULL DEFAULT '0',
                "isActive" boolean NOT NULL DEFAULT true,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_54022accc6ca81931d20b8f30fd" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "schedules" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "day_of_week" integer NOT NULL,
                "start_time" TIME NOT NULL,
                "end_time" TIME NOT NULL,
                "is_available" boolean NOT NULL DEFAULT true,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "userId" uuid,
                CONSTRAINT "PK_7e33fc2ea755a5765e3564e66dd" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "users" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "name" character varying NOT NULL DEFAULT '',
                "lastname" character varying NOT NULL DEFAULT '',
                "email" character varying NOT NULL,
                "phone" character varying NOT NULL,
                "image" character varying,
                "password" character varying NOT NULL,
                "notification_token" character varying,
                "isActive" boolean NOT NULL DEFAULT true,
                "is_google_account" boolean NOT NULL DEFAULT false,
                "tenant_id" uuid,
                "is_email_verified" boolean NOT NULL DEFAULT false,
                "verification_code" character varying,
                "reset_password_code" character varying,
                "reset_password_expires" TIMESTAMP,
                "verification_code_expires" TIMESTAMP,
                "deletedAt" TIMESTAMP,
                "deletionReason" character varying,
                "deletedBy" character varying,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                "owner_id" uuid,
                CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"),
                CONSTRAINT "UQ_a000cca60bcf04454e727699490" UNIQUE ("phone"),
                CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "whatsapp_configurations" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "owner_id" uuid NOT NULL,
                "phone_number" text NOT NULL,
                "api_key" text NOT NULL,
                "is_enabled" boolean NOT NULL DEFAULT true,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_1506e31515dddca372e3b1fa0f6" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "payment_history" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "tenant_id" uuid NOT NULL,
                "amount" numeric(10, 2) NOT NULL,
                "currency" character varying NOT NULL DEFAULT 'COP',
                "status" character varying NOT NULL,
                "wompi_transaction_id" character varying,
                "wompi_transaction_url" character varying,
                "payment_date" TIMESTAMP,
                "metadata" jsonb,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                "subscription_id" uuid,
                CONSTRAINT "PK_5fcec51a769b65c0c3c0987f11c" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "subscriptions" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "tenant_id" uuid NOT NULL,
                "status" character varying NOT NULL DEFAULT 'trial',
                "wompi_customer_id" character varying,
                "wompi_subscription_id" character varying,
                "trial_appointments_used" integer NOT NULL DEFAULT '0',
                "trial_appointments_limit" integer NOT NULL DEFAULT '20',
                "subscription_start_date" TIMESTAMP,
                "subscription_end_date" TIMESTAMP,
                "is_trial_used" boolean NOT NULL DEFAULT false,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                "plan_id" uuid,
                CONSTRAINT "PK_a87248d73155605cf782be9ee5e" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "subscription_plans" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "name" character varying NOT NULL,
                "description" character varying NOT NULL,
                "price" numeric(10, 2) NOT NULL,
                "currency" character varying NOT NULL DEFAULT 'COP',
                "billing_interval" character varying NOT NULL DEFAULT 'month',
                "duration_months" integer NOT NULL DEFAULT '1',
                "is_recurring" boolean NOT NULL DEFAULT false,
                "appointment_limit" integer NOT NULL DEFAULT '-1',
                "wompi_price_id" character varying,
                "is_active" boolean NOT NULL DEFAULT true,
                "features" text,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_9ab8fe6918451ab3d0a4fb6bb0c" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."notifications_receiver_type_enum" AS ENUM('USER', 'CLIENT')
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."notifications_type_enum" AS ENUM(
                'APPOINTMENT_REMINDER',
                'APPOINTMENT_CONFIRMATION',
                'APPOINTMENT_CANCELLATION',
                'NEW_REVIEW',
                'PAYMENT_CONFIRMATION',
                'GENERAL'
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "notifications" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "receiver_id" uuid NOT NULL,
                "receiver_type" "public"."notifications_receiver_type_enum" NOT NULL,
                "type" "public"."notifications_type_enum" NOT NULL,
                "title" text NOT NULL,
                "message" text NOT NULL,
                "read" boolean NOT NULL DEFAULT false,
                "metadata" jsonb,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "appointment_services" (
                "appointment_id" uuid NOT NULL,
                "service_id" uuid NOT NULL,
                CONSTRAINT "PK_0d8cb48b88882567f9bd788b1a0" PRIMARY KEY ("appointment_id", "service_id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_923e323e598280a0454e1d1b7c" ON "appointment_services" ("appointment_id")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_5aafcd787c270f1fd2e01376a6" ON "appointment_services" ("service_id")
        `);
    await queryRunner.query(`
            CREATE TABLE "user_has_roles" (
                "user_id" uuid NOT NULL,
                "role_id" uuid NOT NULL,
                CONSTRAINT "PK_39ff1f7a28026996cf61892cc5b" PRIMARY KEY ("user_id", "role_id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_d2b980baf026ff8347d88ace6e" ON "user_has_roles" ("user_id")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_386dc0042695c976845d36be94" ON "user_has_roles" ("role_id")
        `);
    await queryRunner.query(`
            ALTER TABLE "categories"
            ADD CONSTRAINT "FK_68644b5e755cb081af0b8647b52" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "reviews"
            ADD CONSTRAINT "FK_45a6cefc24d5af16842be69a65a" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "reviews"
            ADD CONSTRAINT "FK_8bf30713187361f910f8fb3c2c1" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "reviews"
            ADD CONSTRAINT "FK_4f67c9296d687e0f144a961cf46" FOREIGN KEY ("professionalId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "clients"
            ADD CONSTRAINT "FK_fe0ecb806e3c381981349ac237b" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "time_block"
            ADD CONSTRAINT "FK_5993f58dc4c0e5c1ba4f0930966" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "time_block"
            ADD CONSTRAINT "FK_210ce14e952fb9f5da3c41ded78" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "payments"
            ADD CONSTRAINT "FK_90213a20c94916e46cd2131364f" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "payments"
            ADD CONSTRAINT "FK_60ea2ad2d3230ad559e10951b7d" FOREIGN KEY ("custom_payment_method_id") REFERENCES "custom_payment_methods"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "appointments"
            ADD CONSTRAINT "FK_c4dbd8eb292b83b5dc67be3cf45" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "appointments"
            ADD CONSTRAINT "FK_60b7a60cf6727d87d525a750414" FOREIGN KEY ("professional_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "services"
            ADD CONSTRAINT "FK_1f8d1173481678a035b4a81a4ec" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "services"
            ADD CONSTRAINT "FK_51d4a7f07c0dd4df864fb442ab7" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "user_services"
            ADD CONSTRAINT "FK_37ea84a080a4b47133471852d54" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "user_services"
            ADD CONSTRAINT "FK_74bbbb213ecc45e9444e3145b2b" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "schedules"
            ADD CONSTRAINT "FK_19c54f24597b318be3892114c75" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "users"
            ADD CONSTRAINT "FK_e9513dcba9cfa7546ed60861ed8" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "payment_history"
            ADD CONSTRAINT "FK_49c67bacd5be8771fdd48781b55" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "subscriptions"
            ADD CONSTRAINT "FK_e45fca5d912c3a2fab512ac25dc" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "appointment_services"
            ADD CONSTRAINT "FK_923e323e598280a0454e1d1b7cf" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE
        `);
    await queryRunner.query(`
            ALTER TABLE "appointment_services"
            ADD CONSTRAINT "FK_5aafcd787c270f1fd2e01376a6b" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "user_has_roles"
            ADD CONSTRAINT "FK_d2b980baf026ff8347d88ace6ee" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
        `);
    await queryRunner.query(`
            ALTER TABLE "user_has_roles"
            ADD CONSTRAINT "FK_386dc0042695c976845d36be948" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No se borra la extensión "uuid-ossp": es de la base, no de este esquema.
    await queryRunner.query(`
            ALTER TABLE "user_has_roles" DROP CONSTRAINT "FK_386dc0042695c976845d36be948"
        `);
    await queryRunner.query(`
            ALTER TABLE "user_has_roles" DROP CONSTRAINT "FK_d2b980baf026ff8347d88ace6ee"
        `);
    await queryRunner.query(`
            ALTER TABLE "appointment_services" DROP CONSTRAINT "FK_5aafcd787c270f1fd2e01376a6b"
        `);
    await queryRunner.query(`
            ALTER TABLE "appointment_services" DROP CONSTRAINT "FK_923e323e598280a0454e1d1b7cf"
        `);
    await queryRunner.query(`
            ALTER TABLE "subscriptions" DROP CONSTRAINT "FK_e45fca5d912c3a2fab512ac25dc"
        `);
    await queryRunner.query(`
            ALTER TABLE "payment_history" DROP CONSTRAINT "FK_49c67bacd5be8771fdd48781b55"
        `);
    await queryRunner.query(`
            ALTER TABLE "users" DROP CONSTRAINT "FK_e9513dcba9cfa7546ed60861ed8"
        `);
    await queryRunner.query(`
            ALTER TABLE "schedules" DROP CONSTRAINT "FK_19c54f24597b318be3892114c75"
        `);
    await queryRunner.query(`
            ALTER TABLE "user_services" DROP CONSTRAINT "FK_74bbbb213ecc45e9444e3145b2b"
        `);
    await queryRunner.query(`
            ALTER TABLE "user_services" DROP CONSTRAINT "FK_37ea84a080a4b47133471852d54"
        `);
    await queryRunner.query(`
            ALTER TABLE "services" DROP CONSTRAINT "FK_51d4a7f07c0dd4df864fb442ab7"
        `);
    await queryRunner.query(`
            ALTER TABLE "services" DROP CONSTRAINT "FK_1f8d1173481678a035b4a81a4ec"
        `);
    await queryRunner.query(`
            ALTER TABLE "appointments" DROP CONSTRAINT "FK_60b7a60cf6727d87d525a750414"
        `);
    await queryRunner.query(`
            ALTER TABLE "appointments" DROP CONSTRAINT "FK_c4dbd8eb292b83b5dc67be3cf45"
        `);
    await queryRunner.query(`
            ALTER TABLE "payments" DROP CONSTRAINT "FK_60ea2ad2d3230ad559e10951b7d"
        `);
    await queryRunner.query(`
            ALTER TABLE "payments" DROP CONSTRAINT "FK_90213a20c94916e46cd2131364f"
        `);
    await queryRunner.query(`
            ALTER TABLE "time_block" DROP CONSTRAINT "FK_210ce14e952fb9f5da3c41ded78"
        `);
    await queryRunner.query(`
            ALTER TABLE "time_block" DROP CONSTRAINT "FK_5993f58dc4c0e5c1ba4f0930966"
        `);
    await queryRunner.query(`
            ALTER TABLE "clients" DROP CONSTRAINT "FK_fe0ecb806e3c381981349ac237b"
        `);
    await queryRunner.query(`
            ALTER TABLE "reviews" DROP CONSTRAINT "FK_4f67c9296d687e0f144a961cf46"
        `);
    await queryRunner.query(`
            ALTER TABLE "reviews" DROP CONSTRAINT "FK_8bf30713187361f910f8fb3c2c1"
        `);
    await queryRunner.query(`
            ALTER TABLE "reviews" DROP CONSTRAINT "FK_45a6cefc24d5af16842be69a65a"
        `);
    await queryRunner.query(`
            ALTER TABLE "categories" DROP CONSTRAINT "FK_68644b5e755cb081af0b8647b52"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_386dc0042695c976845d36be94"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_d2b980baf026ff8347d88ace6e"
        `);
    await queryRunner.query(`
            DROP TABLE "user_has_roles"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_5aafcd787c270f1fd2e01376a6"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_923e323e598280a0454e1d1b7c"
        `);
    await queryRunner.query(`
            DROP TABLE "appointment_services"
        `);
    await queryRunner.query(`
            DROP TABLE "notifications"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."notifications_type_enum"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."notifications_receiver_type_enum"
        `);
    await queryRunner.query(`
            DROP TABLE "subscription_plans"
        `);
    await queryRunner.query(`
            DROP TABLE "subscriptions"
        `);
    await queryRunner.query(`
            DROP TABLE "payment_history"
        `);
    await queryRunner.query(`
            DROP TABLE "whatsapp_configurations"
        `);
    await queryRunner.query(`
            DROP TABLE "users"
        `);
    await queryRunner.query(`
            DROP TABLE "schedules"
        `);
    await queryRunner.query(`
            DROP TABLE "user_services"
        `);
    await queryRunner.query(`
            DROP TABLE "services"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."services_pricetype_enum"
        `);
    await queryRunner.query(`
            DROP TABLE "appointments"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."appointments_payment_status_enum"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."appointments_status_enum"
        `);
    await queryRunner.query(`
            DROP TABLE "payments"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."payments_status_enum"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."payments_payment_method_enum"
        `);
    await queryRunner.query(`
            DROP TABLE "custom_payment_methods"
        `);
    await queryRunner.query(`
            DROP TABLE "time_block"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_7fa45fac84fcfdd07ac1c5ae13"
        `);
    await queryRunner.query(`
            DROP TABLE "clients"
        `);
    await queryRunner.query(`
            DROP TABLE "reviews"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_f33348d6b05ccbb1d6a06afda5"
        `);
    await queryRunner.query(`
            DROP TABLE "categories"
        `);
    await queryRunner.query(`
            DROP TABLE "roles"
        `);
  }
}
