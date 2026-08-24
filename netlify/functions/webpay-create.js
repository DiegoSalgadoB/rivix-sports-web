// netlify/functions/webpay-create.js
//
// Qué hace este archivo, en simple:
// Cuando el cliente hace clic en "Pagar", el sitio le manda a esta función
// el carrito (la lista de productos y el total). Esta función le avisa a
// Transbank "quiero cobrar tanto dinero" y Transbank responde con un link
// al que hay que mandar al cliente para que pague con su tarjeta.
//
// Este archivo usa las credenciales REALES de Transbank (dinero real), leídas
// desde variables de entorno configuradas en Netlify: WEBPAY_COMMERCE_CODE y
// WEBPAY_API_KEY.

const {
  WebpayPlus,
  Options,
  Environment,
} = require('transbank-sdk');

// Códigos de descuento válidos. IMPORTANTE: esta es la lista "de verdad" —
// el monto final que se cobra siempre se calcula acá, nunca confiando en un
// total que venga ya calculado desde el navegador. Si agregas o quitas un
// código, actualiza también la misma lista en index.html (busca
// "CODIGOS_PROMOCIONALES") para que el cliente vea el mismo descuento antes
// de pagar.
const CODIGOS_PROMOCIONALES = {
  BIENVENIDO10: 10, // 10% de descuento
  LEGIONRIVIX15: 15, // 15% de descuento
};

exports.handler = async (event) => {
  // Solo aceptamos pedidos enviados como POST (no se puede "visitar" esta
  // URL directamente desde el navegador)
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Método no permitido' };
  }

  try {
    const data = JSON.parse(event.body);
    const cliente = data.cliente || {};
    const items = Array.isArray(data.items) ? data.items : [];
    const codigoPromo = String(data.codigoPromo || '').trim().toUpperCase();

    if (items.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'El carrito está vacío' }),
      };
    }

    // El monto SIEMPRE se calcula acá, sumando los productos que mandó el
    // cliente y aplicando el descuento si el código es válido — nunca se
    // usa un monto que venga ya calculado desde el navegador, para que
    // nadie pueda manipularlo desde las herramientas de desarrollador.
    const subtotal = items.reduce((acc, it) => acc + Math.round(Number(it.price) || 0), 0);
    const porcentajeDescuento = CODIGOS_PROMOCIONALES[codigoPromo] || 0;
    const descuento = Math.round(subtotal * porcentajeDescuento / 100);
    const amount = subtotal - descuento;

    if (!amount || amount <= 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Monto inválido' }),
      };
    }

    // Validación mínima de los datos de despacho (además de la que ya hace
    // el formulario en el navegador — nunca hay que confiar solo en lo que
    // valida el navegador, por si alguien intenta saltárselo)
    const camposRequeridos = ['nombre', 'rut', 'email', 'telefono', 'direccion', 'comuna', 'region'];
    const faltante = camposRequeridos.find((campo) => !cliente[campo] || String(cliente[campo]).trim() === '');
    if (faltante) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: `Falta el campo: ${faltante}` }),
      };
    }

    // Un identificador único para este pedido (Transbank lo exige).
    // Usamos la fecha/hora + un número random para que nunca se repita.
    const buyOrder = 'RIVIX-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const sessionId = 'sesion-' + Date.now();

    // A esta URL Transbank va a devolver al cliente después de que pague
    // (sea que el pago haya salido bien o mal). Transbank exige que esta URL
    // no supere los 255 caracteres, así que va SIN datos adicionales — solo
    // la dirección base. "event.headers.origin" toma automáticamente la URL
    // del sitio donde se está usando, así funciona tanto en la versión de
    // pruebas (*.netlify.app) como en rivix.cl sin tener que cambiar nada a mano.
    const origin = event.headers.origin || `https://${event.headers.host}`;
    const returnUrl = `${origin}/.netlify/functions/webpay-return`;

    // --- Credenciales de PRODUCCIÓN (dinero real), leídas desde variables de
    // entorno configuradas en Netlify — nunca escritas directo en el código. ---
    const options = new Options(
      process.env.WEBPAY_COMMERCE_CODE,
      process.env.WEBPAY_API_KEY,
      Environment.Production
    );
    const tx = new WebpayPlus.Transaction(options);

    const response = await tx.create(buyOrder, sessionId, amount, returnUrl);

    // Mandamos el correo con el detalle completo del pedido AHORA, en este
    // mismo momento (en vez de esperar a que el pago se confirme). Así no
    // necesitamos guardar los datos en ningún lado para recuperarlos después
    // — el correo ya sale con toda la información mientras la tenemos a mano.
    // Más adelante, cuando Transbank confirme si el pago salió bien o mal
    // (en webpay-return.js), se manda un segundo correo corto avisando el
    // resultado, que se relaciona con este por el número de orden.
    //
    // Va en su propio try/catch: si el correo falla, NO debe impedir que el
    // cliente sea llevado a pagar.
    try {
      await enviarAvisoDePedidoCreado({ buyOrder, amount, subtotal, descuento, codigoPromo, cliente, items });
    } catch (mailError) {
      console.error('No se pudo enviar el correo de aviso de pedido:', mailError);
    }

    // Le devolvemos al sitio el link y el "token" que hay que usar para
    // mandar al cliente a pagar
    return {
      statusCode: 200,
      body: JSON.stringify({
        url: response.url,
        token: response.token,
      }),
    };
  } catch (error) {
    console.error('Error creando transacción Webpay:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'No se pudo iniciar el pago. Intenta nuevamente.' }),
    };
  }
};

// ---------------------------------------------------------------------------
// Correo al que le llegan los avisos de pedidos y ventas
const CORREO_AVISO_VENTAS = 'padelaltamirachile@gmail.com';

// Manda un correo avisando que se creó un pedido y quedó esperando el pago,
// con todo el detalle: cliente, dirección de despacho y productos.
// Usa el servicio Resend (resend.com) — necesita la variable de entorno
// RESEND_API_KEY configurada en Netlify (Site settings → Environment variables).
async function enviarAvisoDePedidoCreado({ buyOrder, amount, subtotal, descuento, codigoPromo, cliente, items }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('RESEND_API_KEY no está configurada — no se envía el aviso.');
    return;
  }

  const formatoMonto = (valor) =>
    new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(valor);

  const filasProductos = items.length
    ? items.map((it) => `<li>${it.name} — ${formatoMonto(it.price)}</li>`).join('')
    : '<li>(sin detalle de productos)</li>';

  const filaDescuento = descuento > 0
    ? `
      <p><strong>Subtotal:</strong> ${formatoMonto(subtotal)}</p>
      <p><strong>Código aplicado:</strong> ${codigoPromo} (-${formatoMonto(descuento)})</p>
    `
    : '';

  const html = `
    <h2>🛒 Nuevo pedido — esperando pago</h2>
    <p>Este correo se manda apenas el cliente hace clic en "Pagar". Si el pago
    se confirma, te va a llegar un segundo correo corto avisando que sí se pagó.</p>

    <p><strong>N° de orden:</strong> ${buyOrder}</p>
    ${filaDescuento}
    <p><strong>Monto a cobrar:</strong> ${formatoMonto(amount)}</p>

    <h3>Productos</h3>
    <ul>${filasProductos}</ul>

    <h3>Datos de despacho</h3>
    <p><strong>Nombre:</strong> ${cliente.nombre}</p>
    <p><strong>RUT:</strong> ${cliente.rut}</p>
    <p><strong>Email:</strong> ${cliente.email}</p>
    <p><strong>Teléfono:</strong> ${cliente.telefono}</p>
    <p><strong>Dirección:</strong> ${cliente.direccion}, ${cliente.comuna}, ${cliente.region}</p>
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
      subject: `Nuevo pedido: ${formatoMonto(amount)} — Orden ${buyOrder}`,
      html,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Resend respondió con error: ${res.status} ${errorText}`);
  }
}

// ---------------------------------------------------------------------------
// ESTE ARCHIVO YA ESTÁ CONFIGURADO PARA PRODUCCIÓN (dinero real).
//
// Las credenciales se leen desde variables de entorno en Netlify:
//   WEBPAY_COMMERCE_CODE = código de comercio entregado por Transbank
//   WEBPAY_API_KEY       = Tbk-Api-Key-Secret entregada por Transbank
//
// Configúralas en: Netlify → Project configuration → Environment variables
// (marcadas como "Contains secret values"). NUNCA escribas esas claves
// directo en este archivo ni las subas a GitHub.
// ---------------------------------------------------------------------------
