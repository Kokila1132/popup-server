const express = require('express');
const axios = require('axios');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();

const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');

app.use(cors());
app.use(express.json());

function formatPhone(phone) {
  if (!phone) return undefined;
  let cleaned = String(phone).trim().replace(/[\s\-()]/g, '').replace(/^0+/, '');
  if (cleaned.startsWith('+')) return cleaned;
  if (/^\d{10}$/.test(cleaned)) return '+91' + cleaned;
  return cleaned;
}

function generateCoupon(percent) {
  return percent === 5 ? "ISHQME5" : "ISHQME10";
}

// Google Sheets Setup
const auth = new google.auth.GoogleAuth({
  keyFile: CREDENTIALS_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

// Nodemailer Setup
let transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
});

// Main API
app.post('/popup-capture', async (req, res) => {
  const { email, phone, discount } = req.body;
  if (!email) return res.status(400).json({ success: false, message: 'Email required.' });

  const formattedPhone = formatPhone(phone);

  try {
    const findResponse = await axios.get(
      `${SHOPIFY_STORE_URL}/admin/api/2023-04/customers/search.json?query=email:${email}`,
      { headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN, 'Content-Type': 'application/json' } }
    );
    const existingCustomer = findResponse.data.customers[0];

    if (existingCustomer) {
      const isPhoneProvided = formattedPhone && (!existingCustomer.phone || existingCustomer.phone !== formattedPhone);
      if (isPhoneProvided) {
        await axios.put(
          `${SHOPIFY_STORE_URL}/admin/api/2023-04/customers/${existingCustomer.id}.json`,
          { customer: { id: existingCustomer.id, phone: formattedPhone, tags: discount } },
          { headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN, 'Content-Type': 'application/json' } }
        );

        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: 'Sheet1!A:Z',
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          resource: { values: [[email, formattedPhone, discount, new Date().toISOString()]] }
        });
      }

      const couponCode = generateCoupon(isPhoneProvided ? 10 : 5);
      await transporter.sendMail({
        from: `"IshqMe" <${GMAIL_USER}>`,
        to: email,
        subject: `Your ${couponCode} Discount Code!`,
        html: `<p>Thank you! Your discount code is <b>${couponCode}</b></p>`
      });

      return res.json({ success: true, message: 'Customer updated and coupon sent.', shopifyCustomer: existingCustomer });
    }

    // New Customer
    const customerData = { email, accepts_marketing: true, tags: discount };
    if (formattedPhone) customerData.phone = formattedPhone;

    const shopifyResponse = await axios.post(
      `${SHOPIFY_STORE_URL}/admin/api/2023-04/customers.json`,
      { customer: customerData },
      { headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN, 'Content-Type': 'application/json' } }
    );

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:Z',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: { values: [[email, formattedPhone || '', discount, new Date().toISOString()]] }
    });

    const couponCode = generateCoupon(formattedPhone ? 10 : 5);
    await transporter.sendMail({
      from: `"IshqMe" <${GMAIL_USER}>`,
      to: email,
      subject: `Your ${couponCode} Discount Code!`,
      html: `<p>Thank you! Your discount code is <b>${couponCode}</b></p>`
    });

    res.json({ success: true, shopifyCustomer: shopifyResponse.data.customer });

  } catch (err) {
    console.error("Error in /popup-capture:", err.response?.data || err.message || err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
