// netlify/functions/webpay-return.js
//
// Qué hace este archivo, en simple:
// Después de que el cliente paga (o cancela) en la página de Webpay,
// Transbank lo manda de vuelta automáticamente a esta dirección. Esta
// función le pregunta a Transbank "oye, ¿este pago se aprobó o no?" y,
// según la respuesta, manda al cliente a una pantalla de "Compra exitosa"
// o a una de "Pago rechazado".

const {
  WebpayPlus,
  Options,
  Environment,
} = require('transbank-sdk');

exports.handler = async (event) => {
  const origin = event.headers.origin || `https://${event.headers.host}`;

  // Transbank puede mandar el token de dos formas distintas según el caso
  // (pago normal, o cliente que canceló apretando "Anular compra")
  const params = event.httpMethod === 'POST'
    ? new URLSearchParams(event.body)
    : new URLSearchParams(event.queryStringParameters);

  const token = params.get('token_ws');
  const tokenCanceled = params.get('TBK_TOKEN');

  // Caso: el cliente canceló el pago antes de terminar
  if (tokenCanceled && !token) {
    return {
      statusCode: 302,
      headers: { Location: `${origin}/pago-fallido.html?motivo=cancelado` },
      body: '',
    };
  }

  if (!token) {
    return {
      statusCode: 302,
      headers: { Location: `${origin}/pago-fallido.html?motivo=sin-token` },
      body: '',
    };
  }

  try {
    // --- Credenciales de PRODUCCIÓN (mismas que en webpay-create.js) ---
    const options = new Options(
      process.env.WEBPAY_COMMERCE_CODE,
      process.env.WEBPAY_API_KEY,
      Environment.Production
    );
    const tx = new WebpayPlus.Transaction(options);

    // "commit" le pregunta a Transbank el resultado final del pago
    const result = await tx.commit(token);

    const aprobado = result.status === 'AUTHORIZED' && result.response_code === 0;

    if (aprobado) {
      const buyOrder = encodeURIComponent(result.buy_order);
      const monto = encodeURIComponent(result.amount);

      // Avisar por correo (versión corta) que el pago de este pedido se
      // confirmó. El detalle completo (cliente, dirección, productos) ya se
      // mandó en un correo aparte cuando se creó el pedido, en
      // webpay-create.js — este correo solo confirma que sí se pagó, y se
      // relaciona con el otro por el número de orden.
      try {
        await enviarAvisoDePagoConfirmado(result);
      } catch (mailError) {
        console.error('No se pudo enviar el correo de confirmación:', mailError);
      }

      return {
        statusCode: 302,
        headers: {
          Location: `${origin}/pago-exitoso.html?orden=${buyOrder}&monto=${monto}`,
        },
        body: '',
      };
    } else {
      return {
        statusCode: 302,
        headers: { Location: `${origin}/pago-fallido.html?motivo=rechazado` },
        body: '',
      };
    }
  } catch (error) {
    console.error('Error confirmando transacción Webpay:', error);
    return {
      statusCode: 302,
      headers: { Location: `${origin}/pago-fallido.html?motivo=error` },
      body: '',
    };
  }
};

// ---------------------------------------------------------------------------
// Este archivo ya está configurado para producción (dinero real), leyendo
// las credenciales desde WEBPAY_COMMERCE_CODE y WEBPAY_API_KEY en Netlify.
// ---------------------------------------------------------------------------

// Correo al que le llega el aviso de cada venta confirmada
const CORREO_AVISO_VENTAS = 'padelaltamirachile@gmail.com';

// Manda un correo CORTO confirmando que un pedido ya fue pagado. El detalle
// completo (cliente, dirección, productos) se mandó antes, al crear el
// pedido — este correo solo confirma el resultado del pago.
async function enviarAvisoDePagoConfirmado(result) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('RESEND_API_KEY no está configurada — no se envía el aviso.');
    return;
  }

  const monto = new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
  }).format(result.amount);

  const html = `
    <h2>✅ Pago confirmado</h2>
    <p>El pedido con N° de orden <strong>${result.buy_order}</strong> fue pagado con éxito.</p>
    <p><strong>Monto:</strong> ${monto}</p>
    <p><strong>Tarjeta terminada en:</strong> ${result.card_detail?.card_number || 'N/D'}</p>
    <p><strong>Fecha:</strong> ${result.transaction_date}</p>
    <p style="color:#666; font-size:0.85em;">El detalle de productos y datos de despacho de este pedido llegó en un correo aparte cuando se generó la orden.</p>
  `;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'RIVIX <onboarding@resend.dev>',
      to: [CORREO_AVISO_VENTAS],
      subject: `✅ Pago confirmado: ${monto} — Orden ${result.buy_order}`,
      html,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Resend respondió con error: ${res.status} ${errorText}`);
  }
}
