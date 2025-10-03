import express from "express";
import { google } from "googleapis";
import axios from "axios";
import nodemailer from "nodemailer";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config(); // Load .env file

const app = express();
const PORT = process.env.PORT || 10000;

// --- Load Environment Variables ---
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;

// Process private key correctly (\n replacement)
const GOOGLE_PRIVATE_KEY_ESCAPED = process.env.GOOGLE_PRIVATE_KEY;
const GOOGLE_PRIVATE_KEY = GOOGLE_PRIVATE_KEY_ESCAPED
  ? GOOGLE_PRIVATE_KEY_ESCAPED.replace(/\\n/g, "\n")
  : null;

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// --- Google Sheets Auth ---
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: GOOGLE_CLIENT_EMAIL,
    private_key: GOOGLE_PRIVATE_KEY,
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

// --- Nodemailer Setup ---
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_APP_PASSWORD,
  },
});

// --- Route: Popup Capture ---
app.post("/popup-capture", async (req, res) => {
  const { email, phone, discount } = req.body;

  if (!email || !phone || !discount) {
    return res
      .status(400)
      .send("Missing required fields: email, phone, or discount.");
  }

  try {
    // 1. Shopify: Create Customer
    if (SHOPIFY_ACCESS_TOKEN && SHOPIFY_STORE_URL) {
      const shopifyResponse = await axios.post(
        `${SHOPIFY_STORE_URL}/admin/api/2023-04/customers.json`,
        {
          customer: {
            email: email,
            phone: phone,
            tags: discount,
            accepts_marketing: true,
          },
        },
        {
          headers: {
            "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
            "Content-Type": "application/json",
          },
        }
      );
      console.log("Shopify Customer Created:", shopifyResponse.data.customer.id);
    } else {
      console.warn("⚠️ Shopify credentials missing, skipping Shopify step.");
    }

    // 2. Google Sheets: Save Data
    if (!SPREADSHEET_ID || !GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) {
      console.error("Google Sheets credentials missing.");
      return res
        .status(500)
        .send({ message: "Internal Server Error: Google Sheets missing." });
    }

    const date = new Date().toLocaleString();
    const sheetData = [[email, phone, discount, date, "Pending"]];

    await auth.getClient(); // verify auth
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "Sheet1!A:E", // Adjusted for 5 columns
      valueInputOption: "USER_ENTERED",
      requestBody: { values: sheetData },
    });

    console.log("✅ Data saved to Google Sheet.");

    // 3. Email: Send Discount Code
    if (GMAIL_USER && GMAIL_APP_PASSWORD) {
      const mailOptions = {
        from: GMAIL_USER,
        to: email,
        subject: "Your Exclusive Discount Code!",
        text: `Thank you for signing up! 🎉 Use your code: ${discount}`,
      };

      await transporter.sendMail(mailOptions);
      console.log("📧 Email sent to:", email);
    } else {
      console.warn("⚠️ Gmail credentials missing, skipping email.");
    }

    // 4. Final Response
    res
      .status(200)
      .send({ message: "Success! Customer, Sheet, and Email processed." });
  } catch (error) {
    console.error("❌ Error in /popup-capture:", error);

    if (error.response?.data) {
      return res.status(500).send({
        message: "API Error",
        details: error.response.data,
      });
    }

    res.status(500).send({ message: `Internal Error: ${error.message}` });
  }
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
