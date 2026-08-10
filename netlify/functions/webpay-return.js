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
  IntegrationApiKeys,
  IntegrationCommerceCodes,
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

  // Los datos de despacho viajaron codificados como parámetro "pedido" en la
  // misma URL de retorno que le dimos a Transbank — este parámetro va en el
  // querystring de la URL, así que se lee directo desde ahí, sin importar
  // si Transbank nos llamó por POST o por GET.
  let pedido = null;
  const pedidoCodificado = event.queryStringParameters?.pedido;
  if (pedidoCodificado) {
    try {
      const json = Buffer.from(pedidoCodificado, 'base64url').toString('utf-8');
      pedido = JSON.parse(json);
    } catch (decodeError) {
      console.error('No se pudo decodificar el parámetro "pedido":', decodeError);
    }
  }

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
    // --- Credenciales de AMBIENTE DE PRUEBA (mismas que en webpay-create.js) ---
    const options = new Options(
      IntegrationCommerceCodes.WEBPAY_PLUS,
      IntegrationApiKeys.WEBPAY,
      Environment.Integration
    );
    const tx = new WebpayPlus.Transaction(options);

    // "commit" le pregunta a Transbank el resultado final del pago
    const result = await tx.commit(token);

    const aprobado = result.status === 'AUTHORIZED' && result.response_code === 0;

    if (aprobado) {
      const buyOrder = encodeURIComponent(result.buy_order);
      const monto = encodeURIComponent(result.amount);

      // Avisar por correo que llegó una venta nueva. Si el correo falla por
      // cualquier motivo, NO queremos que eso rompa la compra del cliente
      // (por eso va en su propio try/catch, separado del pago).
      try {
        await enviarAvisoDeVenta(result, pedido);
      } catch (mailError) {
        console.error('No se pudo enviar el correo de aviso:', mailError);
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
// Para pasar a producción, hacer el mismo cambio que en webpay-create.js
// (reemplazar IntegrationCommerceCodes/IntegrationApiKeys/Environment.Integration
// por las variables de entorno WEBPAY_COMMERCE_CODE, WEBPAY_API_KEY y
// Environment.Production).
// ---------------------------------------------------------------------------

// Correo al que le llega el aviso de cada venta nueva
const CORREO_AVISO_VENTAS = 'padelaltamirachile@gmail.com';

// Manda un correo simple avisando que se aprobó un pago, usando el servicio
// Resend (resend.com). Necesita la variable de entorno RESEND_API_KEY
// configurada en Netlify (Site settings → Environment variables).
//
// "pedido" son los datos que guardamos en webpay-create.js (cliente + items)
// — puede venir null si por algún motivo no se pudo recuperar, y en ese caso
// el correo se manda igual, solo que sin esos detalles extra.
async function enviarAvisoDeVenta(result, pedido) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('RESEND_API_KEY no está configurada — no se envía el aviso.');
    return;
  }

  const monto = new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
  }).format(result.amount);

  const cliente = pedido?.cliente;
  const items = pedido?.items || [];

  const filasProductos = items.length
    ? items.map((it) => `<li>${it.name} — ${new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(it.price)}</li>`).join('')
    : '<li>(no se pudo recuperar el detalle de productos)</li>';

  const datosDespacho = cliente
    ? `
      <h3>Datos de despacho</h3>
      <p><strong>Nombre:</strong> ${cliente.nombre}</p>
      <p><strong>RUT:</strong> ${cliente.rut}</p>
      <p><strong>Email:</strong> ${cliente.email}</p>
      <p><strong>Teléfono:</strong> ${cliente.telefono}</p>
      <p><strong>Dirección:</strong> ${cliente.direccion}, ${cliente.comuna}, ${cliente.region}</p>
    `
    : '<p><em>No se pudieron recuperar los datos de despacho.</em></p>';

  const html = `
    <h2>¡Nueva venta en RIVIX! 🎉</h2>
    <p><strong>N° de orden:</strong> ${result.buy_order}</p>
    <p><strong>Monto:</strong> ${monto}</p>
    <p><strong>Tarjeta terminada en:</strong> ${result.card_detail?.card_number || 'N/D'}</p>
    <p><strong>Fecha:</strong> ${result.transaction_date}</p>

    <h3>Productos</h3>
    <ul>${filasProductos}</ul>

    ${datosDespacho}
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
      subject: `Nueva venta: ${monto} — Orden ${result.buy_order}`,
      html,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Resend respondió con error: ${res.status} ${errorText}`);
  }
}
