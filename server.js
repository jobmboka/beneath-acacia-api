const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ── AFRICA'S TALKING SETUP ──
// Set these in your Render Environment Variables
const credentials = {
  apiKey: process.env.AT_API_KEY,      // Use your Sandbox or Live Key
  username: process.env.AT_USERNAME    // Use 'sandbox' for testing, or your live username
};
const AfricasTalking = require('africastalking')(credentials);
const sms = AfricasTalking.SMS;

// ── REGISTRATION & SMS ROUTE ──
app.post('/register', async (req, res) => {
  const { phone, firstName, lastName, email, itemType } = req.body;

  if (!phone || !firstName || !email) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Format phone to E.164 format for Africa's Talking (e.g., +2547XXXXXXXX)
  let formattedPhone = phone.replace(/\D/g, '');
  if (formattedPhone.startsWith('0')) formattedPhone = '+254' + formattedPhone.slice(1);
  if (formattedPhone.startsWith('254')) formattedPhone = '+' + formattedPhone;

  // Determine the amount based on ticket selection
  const amount = itemType === 'book' ? 'KES 2,000' : 'KES 500';

  // Customize your SMS confirmation message
  const message = `Hello ${firstName}, your RSVP for Beneath The Acacia is confirmed! To complete your registration, please pay ${amount} to Paybill: 123456, Account: ${firstName}. See you on June 12!`;

  try {
    // Send the SMS
    const result = await sms.send({
      to: [formattedPhone],
      message: message,
      // from: 'YOUR_SENDER_ID' // Uncomment if you register a custom Sender ID later
    });

    console.log('✅ SMS Sent successfully:', result.SMSMessageData.Recipients);

    // Respond immediately to the frontend to trigger the success modal
    return res.json({
      success: true,
      message: 'Registration successful and SMS sent.',
    });

  } catch (err) {
    console.error('❌ SMS sending failed:', err);
    // Even if SMS fails, you might still want to show a success modal on the frontend
    return res.status(500).json({ error: 'Registration logged, but SMS failed.' });
  }
});

// ── HEALTH CHECK ──
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Beneath The Acacia Registration & SMS API'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
