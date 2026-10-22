import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';

const DEFAULT_REFERENCE = 'demo_reference';
const DEFAULT_REDIRECT = 'myapp://payment-callback';
// Solo se acepta un esquema de app o http(s); nunca `javascript:` ni `data:`.
const SAFE_REDIRECT = /^(myapp|https?):\/\/[^\s"'<>\\]*$/i;
const SAFE_REFERENCE = /^[A-Za-z0-9_.:-]{1,100}$/;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Página de pago simulada. Solo se registra con `NODE_ENV=development`
 * (ver `DemoPaymentModule`). Pública porque se abre en un webview sin JWT.
 * Los parámetros se validan y se escapan: no se refleja texto arbitrario.
 */
@Public()
@Controller('demo-payment')
export class DemoPaymentController {
  @Get()
  getDemoPaymentPage(
    @Query('reference') reference: string | undefined,
    @Query('redirect') redirect: string | undefined,
    @Res() res: Response,
  ) {
    const safeReference =
      typeof reference === 'string' && SAFE_REFERENCE.test(reference)
        ? reference
        : DEFAULT_REFERENCE;
    const safeRedirect =
      typeof redirect === 'string' && SAFE_REDIRECT.test(redirect)
        ? redirect
        : DEFAULT_REDIRECT;

    // El redirect va en un atributo data-* escapado y el script lo lee de ahí,
    // así no se interpola nada dentro del <script>.
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Demo Payment</title>
  <style>
    body { font-family: Arial; padding: 20px; text-align: center; }
    .btn { padding: 10px 20px; margin: 10px; cursor: pointer; border: none; border-radius: 4px; }
    .success { background: #4CAF50; color: white; }
    .error { background: #f44336; color: white; }
    .container { max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; }
  </style>
</head>
<body>
  <div class="container" id="demo" data-redirect="${escapeHtml(safeRedirect)}">
    <h1>Demo Payment Page</h1>
    <p>This is a demo payment page for testing purposes.</p>
    <p><strong>Reference:</strong> ${escapeHtml(safeReference)}</p>
    <p>Choose a payment result:</p>
    <div>
      <button class="btn success" onclick="simulatePayment('approved')">Approve Payment</button>
      <button class="btn error" onclick="simulatePayment('declined')">Decline Payment</button>
    </div>
  </div>
  <script>
    function simulatePayment(status) {
      var base = document.getElementById('demo').getAttribute('data-redirect');
      var transactionId = 'demo_' + Date.now();
      window.location.href = base + '?status=' + encodeURIComponent(status) +
        '&transaction_id=' + encodeURIComponent(transactionId);
    }
  </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  }
}
