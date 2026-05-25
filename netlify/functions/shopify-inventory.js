const SHOPIFY_API_VERSION = "2026-04";

exports.handler = async function () {
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  const store = process.env.SHOPIFY_STORE_DOMAIN;

  if (!clientId || !clientSecret || !store) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error:
          "Missing one or more env vars: SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, SHOPIFY_STORE_DOMAIN",
      }),
    };
  }

  try {
    // Step 1: obtain access token via Client Credentials Grant
    const tokenRes = await fetch(
      `https://${store}/admin/oauth/access_token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "client_credentials",
        }),
      }
    );

    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Token exchange did not return an access_token",
          tokenResponse: tokenData,
        }),
      };
    }

    const accessToken = tokenData.access_token;

    // Step 2: fetch products using the freshly obtained token
    const productsRes = await fetch(
      `https://${store}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=10`,
      {
        headers: { "X-Shopify-Access-Token": accessToken },
      }
    );

    if (!productsRes.ok) {
      const text = await productsRes.text();
      return {
        statusCode: productsRes.status,
        body: JSON.stringify({
          error: "Shopify products request failed",
          status: productsRes.status,
          detail: text,
        }),
      };
    }

    const data = await productsRes.json();

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
