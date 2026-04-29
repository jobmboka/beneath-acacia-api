const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();

app.use(cors());
app.use(express.json());

// ── ENV VARS (set these in Render dashboard) ──
const CONSUMER_KEY      = process.env.MPESA_CONSUMER_KEY;
const CONSUMER_SECRET   = process.env.MPESA_CONSUMER_SECRET;
const SHORTCODE         = process.env.MPESA_SHORTCODE;       // Sandbox: 174379
const PASSKEY           = process.env.MPESA_PASSKEY;         // Sandbox passkey from Test Credentials
const CALLBACK_URL      = process.env.MPESA_CALLBACK_URL;   // Your Render URL + /mpesa/callback
const IS_SANDBOX        = process.env.MPESA_SANDBOX !== 'false'; // default true until go-live
const PORT              = process.env.PORT || 3000;

// ── API BASE URLs ──
const MPESA_BASE = IS_SANDBOX
  ? 'https://sandbox.safaricom.co.ke'
  : 'https://api.safaricom.co.ke';

// ── STARTUP VALIDATION ──
const missingVars = ['MPESA_CONSUMER_KEY','MPESA_CONSUMER_SECRET','MPESA_SHORTCODE','MPESA_PASSKEY','MPESA_CALLBACK_URL']
  .filter(v => !process.env[v]);
if (missingVars.length) {
  console.error('❌ Missing environment variables:', missingVars.join(', '));
  console.error('Set these in your Render dashboard under Environment.');
}
console.log(`✅ Starting in ${IS_SANDBOX ? 'SANDBOX' : 'PRODUCTION'} mode`);
console.log(`✅ Using base URL: ${MPESA_BASE}`);
console.log(`✅ Shortcode: ${SHORTCODE}`);
console.log(`✅ Callback URL: ${CALLBACK_URL}`);

// In-memory store for pending payments
const pendingPayments = {};

// ── 1. GET OAUTH TOKEN ──
async function getToken() {
  const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
  const res = await axios.get(
    `${MPESA_BASE}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${auth}` } }
  );
  return res.data.access_token;
}

// ── 2. STK PUSH ──
app.post('/mpesa/stkpush', async (req, res) => {
  const { phone, amount, firstName, lastName, email, itemType } = req.body;

  if (!phone || !amount || !firstName || !email) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Format phone: 07XXXXXXXX → 2547XXXXXXXX
  let formattedPhone = phone.replace(/\D/g, '');
  if (formattedPhone.startsWith('0')) formattedPhone = '254' + formattedPhone.slice(1);
  if (formattedPhone.startsWith('+')) formattedPhone = formattedPhone.slice(1);

  const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
  const password  = Buffer.from(`${SHORTCODE}${PASSKEY}${timestamp}`).toString('base64');

  const description = itemType === 'book'
    ? 'Beneath The Acacia - Book Purchase (KES 2000)'
    : 'Beneath The Acacia - Event Registration (KES 500)';

  try {
    const token = await getToken();
    console.log('✅ Got M-Pesa token, sending STK push to:', formattedPhone);

    const stkRes = await axios.post(
      `${MPESA_BASE}/mpesa/stkpush/v1/processrequest`,
      {
        BusinessShortCode: SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: amount,
        PartyA: formattedPhone,
        PartyB: SHORTCODE,
        PhoneNumber: formattedPhone,
        CallBackURL: CALLBACK_URL,
        AccountReference: 'BeneathAcacia',
        TransactionDesc: description,
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    console.log('📲 STK Push response:', JSON.stringify(stkRes.data));

    const { CheckoutRequestID, ResponseCode, CustomerMessage } = stkRes.data;

    if (ResponseCode === '0') {
      // Store pending payment details
      pendingPayments[CheckoutRequestID] = {
        email, firstName, lastName, phone, itemType,
        status: 'pending',
        createdAt: Date.now(),
      };

      // Auto-cleanup after 5 minutes
      setTimeout(() => { delete pendingPayments[CheckoutRequestID]; }, 5 * 60 * 1000);

      return res.json({ success: true, checkoutRequestId: CheckoutRequestID, message: CustomerMessage });
    } else {
      return res.status(400).json({ error: 'STK push failed', details: stkRes.data });
    }
  } catch (err) {
    const errData = err.response?.data || err.message;
    console.error('❌ STK Push error:', JSON.stringify(errData));
    return res.status(500).json({ error: 'Failed to initiate payment', details: errData });
  }
});

// ── 3. MPESA CALLBACK (Safaricom calls this after payment) ──
app.post('/mpesa/callback', (req, res) => {
  const body = req.body?.Body?.stkCallback;
  if (!body) return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  const { CheckoutRequestID, ResultCode, ResultDesc } = body;
  const payment = pendingPayments[CheckoutRequestID];

  if (payment) {
    if (ResultCode === 0) {
      // Payment successful
      const meta = body.CallbackMetadata?.Item || [];
      const getMeta = (name) => meta.find(i => i.Name === name)?.Value;

      payment.status      = 'success';
      payment.mpesaCode   = getMeta('MpesaReceiptNumber');
      payment.amount      = getMeta('Amount');
      payment.paidAt      = getMeta('TransactionDate');
    } else {
      payment.status = 'failed';
      payment.reason = ResultDesc;
    }
  }

  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

// ── 4. POLL PAYMENT STATUS (frontend polls this) ──
app.get('/mpesa/status/:checkoutRequestId', (req, res) => {
  const payment = pendingPayments[req.params.checkoutRequestId];
  if (!payment) return res.json({ status: 'not_found' });
  res.json({
    status:    payment.status,
    mpesaCode: payment.mpesaCode || null,
    firstName: payment.firstName,
    email:     payment.email,
    itemType:  payment.itemType,
  });
});

// ── 5. HEALTH CHECK ──
app.get('/', (req, res) => res.json({ status: 'ok', service: 'Beneath The Acacia Payment API' }));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
