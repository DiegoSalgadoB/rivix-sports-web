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
