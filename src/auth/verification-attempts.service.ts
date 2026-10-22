import { Injectable } from '@nestjs/common';

export type VerificationPurpose = 'verify' | 'reset';

/** Intentos fallidos permitidos por código antes de invalidarlo. */
export const MAX_CODE_ATTEMPTS = 5;
/** Igual que la vigencia del código (10 min): pasado ese tiempo el contador se olvida. */
const ATTEMPTS_TTL_MS = 10 * 60 * 1000;

interface AttemptEntry {
  count: number;
  expiresAt: number;
}

/**
 * Cuenta los intentos fallidos de cada código de verificación o de reset.
 *
 * Limitación conocida (sin cambiar el esquema hasta tener migraciones, 1.08):
 * el contador vive en memoria del proceso. Se pierde al reiniciar y no se comparte
 * entre instancias. Lo compensa el throttle por IP de `/auth/*`, y al llegar al
 * límite el código se borra de la BD, así que ya no sirve aunque el contador se pierda.
 */
@Injectable()
export class VerificationAttemptsService {
  private readonly attempts = new Map<string, AttemptEntry>();

  /** Registra un fallo. Devuelve `true` si se alcanzó el límite (hay que invalidar el código). */
  registerFailure(purpose: VerificationPurpose, userId: string): boolean {
    const key = this.key(purpose, userId);
    const now = Date.now();
    const current = this.attempts.get(key);
    const count = current && current.expiresAt > now ? current.count + 1 : 1;
    this.attempts.set(key, { count, expiresAt: now + ATTEMPTS_TTL_MS });
    this.purgeExpired(now);
    return count >= MAX_CODE_ATTEMPTS;
  }

  /** Olvida los intentos (código nuevo emitido, verificación correcta o código invalidado). */
  reset(purpose: VerificationPurpose, userId: string): void {
    this.attempts.delete(this.key(purpose, userId));
  }

  private key(purpose: VerificationPurpose, userId: string): string {
    return `${purpose}:${userId}`;
  }

  private purgeExpired(now: number): void {
    for (const [key, entry] of this.attempts) {
      if (entry.expiresAt <= now) this.attempts.delete(key);
    }
  }
}
