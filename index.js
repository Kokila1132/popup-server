import express from 'express';
import axios from 'axios';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

// Helper: normalize phone (India example)
function formatPhone(phone) {
  if (!phone) return '';
  let cleaned = String(phone).trim().replace(/[^\d+]/g, '');
  if (/^\d{10}$/.test(cleaned)) return '+91' + cleaned;
  if (/^91\d{10}$/.test(cleaned)) return '+' + cleaned;
  if (cleaned.startsWith('+')) return cleaned;
  return cleaned;
}

// --- GOOGLE AUTH SETUP ---
let googleAuth;
async function initGoogleAuth() {
  try {
    let credentials = null;

    if (process.env.GOOGLE_CREDENTIALS_FILE) {
      const p = path.isAbsolute(process.env.GOOGLE_CREDENTIALS_FILE)
        ? process.env.GOOGLE_CREDENTIALS_FILE
        : path.join(process.cwd(), process.env.GOOGLE_CREDENTIALS_FILE);
      if (fs.existsSync(p)) credentials = JSON.parse(fs.readFileSync(p, 'utf8'));
    }

    if (!credentials && process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
      credentials = {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      };
    }

    if (!credentials) return null;

    googleAuth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const client = await googleAuth.getClient();
    await client.getAccessToken();
    return google.sheets({ version: 'v4', auth: googleAuth });
  } catch (err) {
    console.error('Sheets Auth Error:', err);
    return null;
  }
}

let sheetsClientPromise = initGoogleAuth().then((sheets) => sheets);

// --- Main route ---
app.post('/popup-capture', async (req, res) => {
  const payload = req.body || {};
  const email = payload.email || payload.customer?.email;
  const phoneRaw = payload.phone || payload.customer?.phone || payload.customer?.phone_number || payload.mobile;
  const discount = payload.discount || '5% OFF';

  if (!email) return res.status(400).json({ success: false, message: 'Email required' });

  const phone = formatPhone(phoneRaw);

  try {
    // 1) Shopify: find customer by email
    let shopifyCustomer = null;
    try {
      const searchUrl = `${SHOPIFY_STORE_URL.replace(/\/$/, '')}/admin/api/2023-04/customers/search.json?query=email:${encodeURIComponent(email)}`;
      const findResp = await axios.get(searchUrl, {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });
      shopifyCustomer = findResp.data?.customers?.[0] || null;
    } catch (err) {
      console.warn('Shopify search error:', err.response?.data || err.message);
    }

    if (shopifyCustomer) {
      if (phone && shopifyCustomer.phone !== phone) {
        try {
          await axios.put(
            `${SHOPIFY_STORE_URL.replace(/\/$/, '')}/admin/api/2023-04/customers/${shopifyCustomer.id}.json`,
            { customer: { id: shopifyCustomer.id, phone } },
            { headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN, 'Content-Type': 'application/json' } }
          );
        } catch (upErr) {
          console.warn('Shopify update phone error:', upErr.response?.data || upErr.message);
        }
      }
    } else {
      try {
        const createResp = await axios.post(
          `${SHOPIFY_STORE_URL.replace(/\/$/, '')}/admin/api/2023-04/customers.json`,
          { customer: { first_name: email.split('@')[0], email, phone: phone || undefined, accepts_marketing: true, tags: discount } },
          { headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN, 'Content-Type': 'application/json' } }
        );
        shopifyCustomer = createResp.data?.customer || null;
      } catch (createErr) {
        console.warn('Shopify create error:', createErr.response?.data || createErr.message);
      }
    }

    // 2) Google Sheets append
    const sheets = await sheetsClientPromise;
    if (sheets) {
      try {
        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: 'Sheet1!A:D',
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [[email, phone || '', discount, new Date().toLocaleString()]],
          },
        });
      } catch (sheetErr) {
        console.error('Sheets write error', sheetErr?.response?.data || sheetErr.message);
      }
    }

    // ✅ Mail send removed

    return res.json({ success: true, message: 'Data saved successfully', shopifyCustomer });
  } catch (err) {
    console.error('Unhandled error:', err?.response?.data || err.message || err);
    return res.status(500).json({ success: false, message: 'Server error', details: err?.response?.data || err.message });
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`🚀 Server listening on ${PORT}`));
