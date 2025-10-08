import { google } from "googleapis";
import fs from "fs";
import path from "path";

const credentials = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "credentials.json"))
);

const auth = new google.auth.JWT({
  email: credentials.client_email,
  key: credentials.private_key,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

auth.authorize((err) => {
  if (err) return console.error("Auth Error:", err);
  console.log("✅ Auth OK");
});
