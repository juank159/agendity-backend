// src/firebase/firebase.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as admin from 'firebase-admin';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);

  onModuleInit() {
    try {
      // Inicializar Firebase Admin
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      });
      this.logger.log('Firebase Admin inicializado correctamente');
    } catch (error) {
      this.logger.error(
        `Error inicializando Firebase Admin: ${error.message}`,
        error.stack,
      );
    }
  }

  async sendNotification(options: {
    token: string;
    title: string;
    body: string;
    data?: Record<string, string>;
  }) {
    try {
      const { token, title, body, data } = options;

      // Asegurarse de que todos los datos son strings
      const processedData = {};
      if (data) {
        Object.keys(data).forEach((key) => {
          processedData[key] = String(data[key]);
        });
      }

      const message: admin.messaging.Message = {
        token,
        notification: {
          title,
          body,
        },
        data: processedData,
        android: {
          priority: 'high',
          notification: {
            channelId: 'appointment_reminders',
            priority: 'high',
          },
        },
        apns: {
          payload: {
            aps: {
              contentAvailable: true,
              badge: 1,
              sound: 'default',
              alert: {
                title: title,
                body: body,
              },
            },
          },
          headers: {
            'apns-priority': '10',
          },
        },
      };

      this.logger.log(
        `Enviando notificación push: ${JSON.stringify({
          title,
          body,
          token: token.substring(0, 20) + '...',
          data: processedData,
        })}`,
      );

      const response = await admin.messaging().send(message);
      this.logger.log(`Notificación push enviada con éxito: ${response}`);
      return { success: true, messageId: response };
    } catch (error) {
      this.logger.error(
        `Error enviando notificación push: ${error.message}`,
        error.stack,
      );
      return { success: false, error: error.message };
    }
  }
}
