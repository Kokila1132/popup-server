const express = require('express');
const axios = require('axios');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();

// -----------------------------
// Configuration (Replace with your actual credentials)
// -----------------------------
const SHOPIFY_ACCESS_TOKEN = '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';
const SHOPIFY_STORE_URL = 'https://ishqme.myshopify.com';
const GMAIL_USER = 'contact@ishqme.com';
const GMAIL_APP_PASSWORD = 'yddn kxki rdpi yubn'; // Use env var in production!
const SPREADSHEET_ID = '1sLfWkKMz5Y1CNhTNfIPWWljMGBNkO96FDRem8kz591A';
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');

// -----------------------------
// Middleware
// -----------------------------
app.use(cors());
app.use(express.json());

// -----------------------------
// Helper functions
// -----------------------------
function formatPhone(phone) {
  if (!phone) return undefined;
  let cleaned = String(phone).trim().replace(/[\s\-()]/g, '').replace(/^0+/, '');
  if (cleaned.startsWith('+')) return cleaned;
  if (/^\d{10}$/.test(cleaned)) return '+91' + cleaned;
  return cleaned;
}

function generateCoupon(percent) {
  return percent === 5 ? 'ISHQME5' : 'ISHQME10';
}

// -----------------------------
// Google Sheets Setup
// -----------------------------
const auth = new google.auth.GoogleAuth({
  keyFile: CREDENTIALS_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

// -----------------------------
// Nodemailer Setup
// -----------------------------
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
});

// -----------------------------
// Main API Route
// -----------------------------
app.post('/popup-capture', async (req, res) => {
  const { email, phone, discount } = req.body;
  if (!email) return res.status(400).json({ success: false, message: 'Email is required.' });

  const formattedPhone = formatPhone(phone);

  try {
    // Check if customer exists in Shopify
    const findResponse = await axios.get(
      `${SHOPIFY_STORE_URL}/admin/api/2023-04/customers/search.json?query=email:${email}`,
      { headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN, 'Content-Type': 'application/json' } }
    );

    const existingCustomer = findResponse.data.customers[0];

    // ----------------- CUSTOMER EXISTS -----------------
    if (existingCustomer) {
      const isPhoneProvided = formattedPhone && (!existingCustomer.phone || existingCustomer.phone !== formattedPhone);

      // Update Shopify if new phone is provided
      if (isPhoneProvided) {
        await axios.put(
          `${SHOPIFY_STORE_URL}/admin/api/2023-04/customers/${existingCustomer.id}.json`,
          { customer: { id: existingCustomer.id, phone: formattedPhone, tags: discount } },
          { headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN, 'Content-Type': 'application/json' } }
        );

        // Log to Google Sheet
        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: 'Sheet1!A:Z',
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          resource: { values: [[email, formattedPhone, discount, new Date().toISOString()]] }
        });
      }

      // Send Coupon Email
      const couponCode = generateCoupon(isPhoneProvided ? 10 : 5);
      await transporter.sendMail({
        from: `"IshqMe" <${GMAIL_USER}>`,
        to: email,
        subject: `Your ${couponCode} Discount Code!`,
        html: `<p>Thank you! Your discount code is <b>${couponCode}</b></p>`,
      });

      return res.json({
        success: true,
        message: isPhoneProvided
          ? 'Existing customer updated with phone. Coupon sent.'
          : 'Email already registered. Coupon sent to existing customer.',
        shopifyCustomer: existingCustomer,
      });
    }

    // ----------------- NEW CUSTOMER -----------------
    const customerData = { email, accepts_marketing: true, tags: discount };
    if (formattedPhone) customerData.phone = formattedPhone;

    const shopifyResponse = await axios.post(
      `${SHOPIFY_STORE_URL}/admin/api/2023-04/customers.json`,
      { customer: customerData },
      { headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN, 'Content-Type': 'application/json' } }
    );

    // Log to Google Sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:Z',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: { values: [[email, formattedPhone || '', discount, new Date().toISOString()]] }
    });

    // Send Coupon Email
    const couponCode = generateCoupon(formattedPhone ? 10 : 5);
    await transporter.sendMail({
      from: `"IshqMe" <${GMAIL_USER}>`,
      to: email,
      subject: `Your ${couponCode} Discount Code!`,
      html: `<p>Thank you! Your discount code is <b>${couponCode}</b></p>`,
    });

    res.json({ success: true, shopifyCustomer: shopifyResponse.data.customer });

  } catch (err) {
    console.error('Error in /popup-capture:', err.response?.data || err.message || err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// -----------------------------
// Start Server
// -----------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
