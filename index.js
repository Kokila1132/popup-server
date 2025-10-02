const express = require('express');
const { google } = require('googleapis');
const axios = require('axios');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 10000;

// --- Load Environment Variables ---
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN; // shpat_...
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL; // https://ishqme.myshopify.com
const SPREADSHEET_ID = process.env.SPREADSHEET_ID; // 1sLfWkKMz5Y...
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL; // popup-952@... (Ensure this is the new email!)
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY; // The NEW multi-line key

const GMAIL_USER = process.env.GMAIL_USER; // contact@ishqme.com
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD; // yddnkxkirdpiyubn

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ----------------------------------------------------------------------
// --- GOOGLE SHEETS AUTHENTICATION ---
// This uses the credentials object to read the secrets from environment variables.
// ----------------------------------------------------------------------

const auth = new google.auth.GoogleAuth({
    credentials: { 
        client_email: GOOGLE_CLIENT_EMAIL, 
        private_key: GOOGLE_PRIVATE_KEY // Uses the environment variable
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

// --- Email Transport Setup (Nodemailer) ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: GMAIL_USER,
        pass: GMAIL_APP_PASSWORD,
    },
});

// --- POST Route for capturing data ---
app.post('/popup-capture', async (req, res) => {
    const { email, phone, discount } = req.body;

    if (!email || !phone || !discount) {
        return res.status(400).send('Missing required fields: email, phone, or discount.');
    }

    try {
        // 1. SHOPIFY CUSTOMER CREATION (This step is working)
        const shopifyResponse = await axios.post(
            `${SHOPIFY_STORE_URL}/admin/api/2023-04/customers.json`,
            {
                customer: {
                    email: email,
                    phone: phone,
                    tags: discount,
                    accepts_marketing: true
                }
            },
            {
                headers: {
                    'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                    'Content-Type': 'application/json'
                }
            }
        );
        console.log('Shopify Customer Created:', shopifyResponse.data.customer.id);


        // 2. GOOGLE SHEETS DATA STORAGE (This is the failing step)
        const date = new Date().toLocaleString();
        const sheetData = [
            [date, email, phone, discount]
        ];
        
        // This is the line that will fail if the new Private Key is not correctly added to Render.
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Sheet1!A:D', // Ensure your sheet name is 'Sheet1'
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: sheetData,
            },
        });
        console.log('Data successfully stored in Google Sheet.');


        // 3. SEND DISCOUNT EMAIL
        const mailOptions = {
            from: GMAIL_USER,
            to: email,
            subject: 'Your Exclusive Discount Code!',
            text: `Thank you for signing up! Use your code: ${discount}`,
        };

        await transporter.sendMail(mailOptions);
        console.log('Discount email sent to:', email);


        // 4. FINAL RESPONSE
        res.status(200).send({ message: 'Success! Customer created, data saved, and email sent.' });

    } catch (error) {
        console.error('Error in /popup-capture:', error.response ? error.response.data : error.message);
        
        // This 500 error will persist until the NEW Private Key is correctly read by Render.
        res.status(500).send({ message: 'Internal Server Error: Failed to save data to Google Sheet.' });
    }
});

// --- Start Server ---
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});