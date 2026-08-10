// netlify/functions/webpay-create.js
//
// Qué hace este archivo, en simple:
// Cuando el cliente hace clic en "Pagar", el sitio le manda a esta función
// el carrito (la lista de productos y el total). Esta función le avisa a
// Transbank "quiero cobrar tanto dinero" y Transbank responde con un link
// al que hay que mandar al cliente para que pague con su tarjeta.
//
// HOY este archivo usa las credenciales de PRUEBA de Transbank (son públicas,
// las mismas para todos los que están probando su integración — no hay que
// pedirle nada a Transbank todavía para que esto funcione en modo prueba).
// Cuando Transbank apruebe la afiliación real, se reemplazan por las
// credenciales de producción (ver instrucciones al final del archivo).

const {
  WebpayPlus,
  Options,
  IntegrationApiKeys,
  IntegrationCommerceCodes,
  Environment,
} = require('transbank-sdk');

exports.handler = async (event) => {
  // Solo aceptamos pedidos enviados como POST (no se puede "visitar" esta
  // URL directamente desde el navegador)
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Método no permitido' };
  }

  try {
    const data = JSON.parse(event.body);
    const amount = Math.round(Number(data.amount)); // monto total en pesos chilenos, sin decimales

    if (!amount || amount <= 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Monto inválido' }),
      };
    }

    // Un identificador único para este pedido (Transbank lo exige).
    // Usamos la fecha/hora + un número random para que nunca se repita.
    const buyOrder = 'RIVIX-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const sessionId = 'sesion-' + Date.now();

    // A esta URL Transbank va a devolver al cliente después de que pague
    // (sea que el pago haya salido bien o mal). "event.headers.origin" toma
    // automáticamente la URL del sitio donde se está usando, así funciona
    // tanto en la versión de pruebas (*.netlify.app) como en rivix.cl sin
    // tener que cambiar nada a mano.
    const origin = event.headers.origin || `https://${event.headers.host}`;
    const returnUrl = `${origin}/.netlify/functions/webpay-return`;

    // --- Credenciales de AMBIENTE DE PRUEBA (públicas, provistas por Transbank) ---
    const options = new Options(
      IntegrationCommerceCodes.WEBPAY_PLUS,
      IntegrationApiKeys.WEBPAY,
      Environment.Integration
    );
    const tx = new WebpayPlus.Transaction(options);

    const response = await tx.create(buyOrder, sessionId, amount, returnUrl);

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
// CÓMO PASAR A PRODUCCIÓN (cuando Transbank ya aprobó la afiliación real):
//
// 1. Reemplaza este bloque:
//      const options = new Options(
//        IntegrationCommerceCodes.WEBPAY_PLUS,
//        IntegrationApiKeys.WEBPAY,
//        Environment.Integration
//      );
//
//    por:
//      const options = new Options(
//        process.env.WEBPAY_COMMERCE_CODE,
//        process.env.WEBPAY_API_KEY,
//        Environment.Production
//      );
//
// 2. En Netlify: Site settings → Environment variables, agrega:
//      WEBPAY_COMMERCE_CODE = (el código que te dio Transbank)
//      WEBPAY_API_KEY       = (la llave secreta que te dio Transbank)
//
//    NUNCA escribas esas dos claves directamente en este archivo ni las subas
//    a GitHub — por eso van como "variables de entorno" en Netlify.
// ---------------------------------------------------------------------------
