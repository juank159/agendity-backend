// Lógica pura de la página de consentimiento (11.06), sin DOM: se prueba con
// `node --test test/web/` (script `npm run test:web`).

/** Token de `/consentimiento/<token>` (o '' si no hay). */
export function tokenFromPath(pathname) {
  const raw = pathname.replace(/^\/consentimiento\/?/, '').split('/')[0] || '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return '';
  }
}

/** Texto para cada estado del link y de la respuesta. */
export function consentMessage(state, businessName = 'El negocio') {
  switch (state) {
    case 'accepted':
      return `¡Listo! ${businessName} te enviará los recordatorios por WhatsApp. Para dejar de recibirlos, escribe BAJA en el chat.`;
    case 'declined':
      return 'Entendido: no cambiamos nada. Puedes cerrar esta página.';
    case 'used':
      return 'Este link ya se usó. Si quieres cambiar tu respuesta, pídele un link nuevo al negocio.';
    case 'expired':
      return 'Este link venció. Pídele uno nuevo al negocio.';
    case 'invalid':
      return 'Este link no es válido. Revisa que esté completo o pídele uno nuevo al negocio.';
    case 'rate':
      return 'Hiciste demasiados intentos. Espera un minuto y vuelve a intentarlo.';
    default:
      return 'Algo salió mal. Inténtalo de nuevo en unos minutos.';
  }
}

/** Estado de la página según la respuesta HTTP de la API. */
export function stateFromResponse(status, body) {
  if (status === 404) return 'invalid';
  if (status === 429) return 'rate';
  if (status === 409) {
    return /us[oó]/i.test(body?.message ?? '') ? 'used' : 'expired';
  }
  if (status >= 200 && status < 300) return body?.state ?? 'error';
  return 'error';
}
