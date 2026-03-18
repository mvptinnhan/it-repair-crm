// server.js (GEMINI PRODUCTION VERSION)
console.log("🔑 ENV GEMINI_API_KEY:", process.env.GEMINI_API_KEY ? "✅ Có" : "❌ Không");
console.log("🔑 Key length:", process.env.GEMINI_API_KEY?.length);
console.log("🔑 Key prefix:", process.env.GEMINI_API_KEY?.substring(0, 10) + "...");

import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import { GoogleGenerativeAI } from "@google/generative-ai";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MONGO_URL = process.env.MONGO_URL;

// Khởi tạo Gemini
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
  model: "gemini-1.5-flash",
  generationConfig: {
    temperature: 0.2,
    maxOutputTokens: 500,
  }
});

// =============================
// CONNECT DATABASE
// =============================
mongoose.connect(MONGO_URL)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.log("❌ MongoDB error:", err));

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
  virus: { name: "Diệt virus", price: "100k - 250k" },
  blue_screen: { name: "Sửa lỗi màn hình xanh", price: "150k - 400k" },
  other: { name: "Kiểm tra tổng quát", price: "Liên hệ" }
};

// Middleware log mọi request
app.use((req, res, next) => {
  console.log(`📨 ${new Date().toISOString()} - ${req.method} ${req.url}`);
  if (req.method === 'POST') {
    console.log("📦 Body:", req.body);
  }
  next();
});

// =============================
// AI ANALYZE WITH GEMINI
// =============================
app.post("/analyze", async (req, res) => {
  const { text } = req.body;
  
  console.log("🎯 /analyze POST hit at", new Date().toISOString());
  console.log("📝 Input text:", text);

  if (!text) {
    return res.json({ success: false, error: "Missing text input" });
  }

  const prompt = `Bạn là chuyên gia sửa máy tính. Phân tích lỗi và trả về JSON:
{
  "intent": "repair|optimize",
  "device": "pc|laptop", 
  "issue": "no_power|slow|virus|blue_screen|other",
  "suggestion": "hướng xử lý bằng tiếng Việt"
}
Lỗi: "${text}"`;

  try {
    console.log("📤 Gửi request đến Gemini...");
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    let content = response.text();
    
    console.log("📥 Gemini response:", content);

    // Xử lý JSON
    content = content.replace(/```json|```/g, "").trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
      throw new Error("Không tìm thấy JSON");
    }
    
    const parsed = JSON.parse(jsonMatch[0]);
    console.log("✅ Parsed:", parsed);

    const service = SERVICE_MAP[parsed.issue] || SERVICE_MAP.other;

    return res.json({ success: true, ai: parsed, service });

  } catch (err) {
    console.error("🔥 Gemini error:", err.message);
    
    // Fallback thông minh
    const fallback = {
      no_power: {
        ai: { intent: "repair", device: "pc", issue: "no_power", 
              suggestion: "Kiểm tra nguồn điện, dây nguồn, nút nguồn." },
        service: SERVICE_MAP.no_power
      },
      slow: {
        ai: { intent: "optimize", device: "pc", issue: "slow",
              suggestion: "Vệ sinh quạt, tối ưu Windows, nâng cấp RAM/SSD." },
        service: SERVICE_MAP.slow
      }
    };
    
    let key = "other";
    if (text.includes("không lên")) key = "no_power";
    else if (text.includes("chậm")) key = "slow";
    
    return res.json({ 
      success: true, 
      ...(fallback[key] || fallback.no_power),
      note: "Dùng chế độ dự phòng"
    });
  }
});

// =============================
// BOOKING ROUTES
// =============================
app.post("/booking", async (req, res) => {
  try {
    const item = await Booking.create({
      ...req.body,
      status: "new",
      created_at: new Date()
    });
    res.json({ success: true, data: item });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.get("/bookings", async (req, res) => {
  const data = await Booking.find().sort({ created_at: -1 });
  res.json(data);
});

app.post("/booking/update", async (req, res) => {
  const { id, status } = req.body;
  await Booking.findByIdAndUpdate(id, { status });
  res.json({ success: true });
});

// =============================
// HEALTH CHECK
// =============================
app.get("/", (req, res) => {
  res.send("IT Repair CRM API running with Gemini 🚀");
});

// =============================
// START SERVER
// =============================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});