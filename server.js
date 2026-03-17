// server.js (FINAL PRODUCTION VERSION)

import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import mongoose from "mongoose";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MONGO_URL = process.env.MONGO_URL;

// =============================
// CONNECT DATABASE
// =============================
mongoose.connect(MONGO_URL)
  .then(()=>console.log("MongoDB connected"))
  .catch(err=>console.log(err));

const BookingSchema = new mongoose.Schema({
  name: String,
  phone: String,
  issue: String,
  service: String,
  status: String,
  created_at: Date
});

const Booking = mongoose.model("Booking", BookingSchema);

// =============================
// SERVICE MAP
// =============================
const SERVICE_MAP = {
  no_power: { name: "Sửa máy không lên nguồn", price: "100k - 500k" },
  slow: { name: "Tối ưu / nâng cấp", price: "50k - 300k" },
  virus: { name: "Diệt virus", price: "100k - 250k" }
};

// =============================
// AI ANALYZE
// =============================
app.post("/analyze", async (req, res) => {
  const { text } = req.body;

  const prompt = `
Trả về JSON duy nhất:
{
"intent":"repair|optimize",
"device":"pc|laptop",
"issue":"no_power|slow|virus|other",
"suggestion":"..."
}
Lỗi: ${text}`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
        temperature: 0
      })
    });

    const data = await response.json();
    let content = data.choices[0].message.content;

    // FIX JSON
    content = content.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      return res.json({ success:false, error:"JSON parse error", raw: content });
    }

    const service = SERVICE_MAP[parsed.issue] || { name:"Kiểm tra", price:"Liên hệ" };

    res.json({ success:true, ai: parsed, service });

  } catch (err) {
    res.json({ success:false, error:"AI error" });
  }
});

// =============================
// CREATE BOOKING
// =============================
app.post("/booking", async (req, res)=>{
  try{
    const item = await Booking.create({
      ...req.body,
      status: "new",
      created_at: new Date()
    });

    res.json({ success:true, data:item });
  }catch{
    res.json({ success:false });
  }
});

// =============================
// GET BOOKINGS
// =============================
app.get("/bookings", async (req,res)=>{
  const data = await Booking.find().sort({ created_at:-1 });
  res.json(data);
});

// =============================
// UPDATE STATUS
// =============================
app.post("/booking/update", async (req,res)=>{
  const { id, status } = req.body;

  await Booking.findByIdAndUpdate(id, { status });

  res.json({ success:true });
});

// =============================
// HEALTH CHECK
// =============================
app.get("/", (req,res)=>{
  res.send("IT Repair CRM API running...");
});

app.listen(PORT, ()=>{
  console.log("Server running on port " + PORT);
});
