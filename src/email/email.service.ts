// src/email/email.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;
  private readonly logger = new Logger(EmailService.name);

  constructor(private configService: ConfigService) {
    const emailUser = this.configService.get<string>('EMAIL_USER');
    const emailPassword = this.configService.get<string>('EMAIL_PASSWORD');

    if (!emailUser || !emailPassword) {
      this.logger.error('EMAIL_USER o EMAIL_PASSWORD no configurados');
    }

    this.logger.log(`Configurando transporter con usuario: ${emailUser}`);

    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: emailUser,
        pass: emailPassword,
      },
    });

    // Verificar configuración al inicio
    this.transporter
      .verify()
      .then(() => this.logger.log('Conexión a servidor de correo establecida'))
      .catch((err) =>
        this.logger.error('Error al conectar con servidor de correo:', err),
      );
  }

  async sendVerificationCode(email: string, code: string): Promise<boolean> {
    try {
      this.logger.log(`Enviando código ${code} a ${email}`);

      const mailOptions = {
        from: this.configService.get<string>('EMAIL_USER'),
        to: email,
        subject: 'Código de verificación',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Verificación de correo electrónico</h2>
            <p>Gracias por registrarte. Tu código de verificación es:</p>
            <div style="background-color: #f4f4f4; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px;">
              ${code}
            </div>
            <p>Este código expirará en 10 minutos.</p>
          </div>
        `,
      };

      const info = await this.transporter.sendMail(mailOptions);
      this.logger.log(`Correo enviado: ${info.messageId}`);
      return true;
    } catch (error) {
      this.logger.error('Error enviando email:', error);
      return false;
    }
  }

  async sendPasswordResetCode(email: string, code: string): Promise<boolean> {
    try {
      console.log(`Enviando código de recuperación ${code} a ${email}`);

      const mailOptions = {
        from: this.configService.get('EMAIL_USER'),
        to: email,
        subject: 'Recuperación de contraseña',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Recuperación de contraseña</h2>
            <p>Has solicitado restablecer tu contraseña. Tu código de recuperación es:</p>
            <div style="background-color: #f4f4f4; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px;">
              ${code}
            </div>
            <p>Este código expirará en 30 minutos.</p>
            <p>Si no solicitaste restablecer tu contraseña, ignora este mensaje.</p>
          </div>
        `,
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log(`Correo de recuperación enviado: ${info.messageId}`);
      return true;
    } catch (error) {
      console.error('Error enviando email de recuperación:', error);
      return false;
    }
  }
}
