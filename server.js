// server.js (GEMINI PRODUCTION VERSION - Using gemini-2.0-flash-exp)
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

// =============================
// INIT GEMINI-2.0-FLASH-EXP
// =============================
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
  model: "gemini-2.0-flash-exp",  // Model mới nhất đang hoạt động
  generationConfig: {
    temperature: 0.1,
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
// SERVICE MAP MỞ RỘNG
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
// AI ANALYZE WITH GEMINI-2.0
// =============================
app.post("/analyze", async (req, res) => {
  const { text } = req.body;
  
  console.log("🎯 /analyze POST hit at", new Date().toISOString());
  console.log("📝 Input text:", text);

  if (!text) {
    return res.json({ success: false, error: "Missing text input" });
  }

  const prompt = `Bạn là chuyên gia sửa máy tính. Hãy phân tích lỗi sau và trả về JSON DUY NHẤT:

{
  "intent": "repair",
  "device": "pc",
  "issue": "no_power",
  "suggestion": "Kiểm tra nguồn điện, dây nguồn, nút nguồn."
}

Quy tắc:
- intent: "repair" (sửa chữa) hoặc "optimize" (tối ưu)
- device: "pc" hoặc "laptop"
- issue: "no_power" (không nguồn), "slow" (chậm), "virus", "blue_screen", "other"
- suggestion: hướng xử lý bằng tiếng Việt (1-2 câu)

Lỗi: "${text}"

CHỈ TRẢ VỀ JSON, KHÔNG THÊM GÌ KHÁC.`;

  try {
    console.log("📤 Gửi request đến Gemini-2.0...");
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    let content = response.text();
    
    console.log("📥 Gemini raw response:", content);

    // Xử lý response
    content = content.replace(/```json|```|`/g, "").trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        console.log("✅ Parsed JSON:", parsed);
        
        const service = SERVICE_MAP[parsed.issue] || SERVICE_MAP.other;
        return res.json({ success: true, ai: parsed, service });
      } catch (e) {
        console.error("❌ JSON parse error:", e.message);
      }
    }
    
    // Fallback thông minh dựa trên text
    const lowerText = text.toLowerCase();
    let issue = "other";
    let suggestion = "Vui lòng gọi 0900 000 000 để được tư vấn.";
    
    if (lowerText.includes("không lên") || lowerText.includes("không nguồn")) {
      issue = "no_power";
      suggestion = "Kiểm tra nguồn điện, dây nguồn, nút nguồn. Nếu vẫn không lên, có thể do mainboard.";
    } else if (lowerText.includes("chậm") || lowerText.includes("đơ")) {
      issue = "slow";
      suggestion = "Vệ sinh quạt tản nhiệt, tối ưu Windows, nâng cấp RAM hoặc SSD.";
    } else if (lowerText.includes("virus")) {
      issue = "virus";
      suggestion = "Quét virus, cài lại Windows nếu nặng.";
    } else if (lowerText.includes("xanh")) {
      issue = "blue_screen";
      suggestion = "Kiểm tra driver, gỡ phần mềm mới cài.";
    }
    
    const aiResponse = {
      intent: issue === "slow" ? "optimize" : "repair",
      device: "pc",
      issue,
      suggestion
    };
    
    const service = SERVICE_MAP[issue];
    return res.json({ success: true, ai: aiResponse, service });

  } catch (err) {
    console.error("🔥 Gemini error:", err.message);
    
    // Fallback cứng
    const fallback = {
      no_power: {
        ai: { intent: "repair", device: "pc", issue: "no_power", suggestion: "Kiểm tra nguồn điện, dây nguồn, nút nguồn." },
        service: SERVICE_MAP.no_power
      },
      slow: {
        ai: { intent: "optimize", device: "pc", issue: "slow", suggestion: "Vệ sinh quạt, tối ưu Windows." },
        service: SERVICE_MAP.slow
      }
    };
    
    let issue = "other";
    if (text.includes("không lên")) issue = "no_power";
    else if (text.includes("chậm")) issue = "slow";
    
    return res.json({ 
      success: true, 
      ...(fallback[issue] || fallback.no_power),
      note: "Dùng chế độ dự phòng"
    });
  }
});

// =============================
// BOOKING ROUTES (giữ nguyên)
// =============================
app.post("/booking", async (req, res) => {
  try {
    const item = await Booking.create({ ...req.body, status: "new", created_at: new Date() });
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

app.use((req, res) => {
  res.status(404).json({ success: false, error: "Endpoint not found" });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});