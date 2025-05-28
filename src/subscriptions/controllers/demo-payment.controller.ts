import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';

@Controller('demo-payment')
export class DemoPaymentController {
  @Get()
  getDemoPaymentPage(@Query() query, @Res() res: Response) {
    const reference = query.reference || 'demo_reference';
    const redirectUrl = query.redirect || 'myapp://payment-callback';

    // Renderiza una página HTML simple que simule la página de pago
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
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
        <div class="container">
          <h1>Demo Payment Page</h1>
          <p>This is a demo payment page for testing purposes.</p>
          <p><strong>Reference:</strong> ${reference}</p>
          <p>Choose a payment result:</p>
          <div>
            <button class="btn success" onclick="simulatePayment('approved')">Approve Payment</button>
            <button class="btn error" onclick="simulatePayment('declined')">Decline Payment</button>
          </div>
        </div>
        
        <script>
          function simulatePayment(status) {
            // Generar ID de transacción único
            const transactionId = 'demo_' + Date.now();
            
            // Redirige de vuelta a tu app con el estado del pago
            const redirectUrl = '${redirectUrl}?status=' + status + '&transaction_id=' + transactionId;
            console.log('Redirecting to: ' + redirectUrl);
            window.location.href = redirectUrl;
          }
        </script>
      </body>
      </html>
    `;

    res.setHeader('Content-Type', 'text/html');
    return res.send(html);
  }
}
