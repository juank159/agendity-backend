// En src/payments/repositories/payment.repository.ts

import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Payment } from '../entities/payment.entity';

@Injectable()
export class PaymentRepository extends Repository<Payment> {
  constructor(private dataSource: DataSource) {
    super(Payment, dataSource.createEntityManager());
  }

  // Sobrescribe el método save para asegurar correcta zona horaria
  async savePayment(payment: Payment): Promise<Payment> {
    // Aseguramos que las fechas estén en la zona horaria correcta
    if (!payment.created_at) {
      payment.created_at = new Date(); // Fecha local actual
    }

    if (!payment.updated_at) {
      payment.updated_at = new Date(); // Fecha local actual
    }

    // Asegura que las fechas no pierdan su zona horaria
    const savedPayment = await this.save(payment);

    // Forzar una recarga para verificar cómo se guardó realmente
    // Actualizado para usar la sintaxis correcta de findOne en TypeORM reciente
    const reloadedPayment = await this.findOne({
      where: { id: savedPayment.id },
    });

    return reloadedPayment;
  }
}
