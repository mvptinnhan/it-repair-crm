// server.js (GEMINI PRODUCTION VERSION - Using gemini-1.0-pro)
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
// INIT GEMINI-1.0-PRO
// =============================
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
  model: "gemini-1.0-pro",  // Model ổn định, chắc chắn tồn tại
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
// AI ANALYZE WITH GEMINI-1.0-PRO
// =============================
app.post("/analyze", async (req, res) => {
  const { text } = req.body;
  
  console.log("🎯 /analyze POST hit at", new Date().toISOString());
  console.log("📝 Input text:", text);

  if (!text) {
    return res.json({ success: false, error: "Missing text input" });
  }

  // Prompt được thiết kế để Gemini trả về JSON chính xác
  const prompt = `Bạn là chuyên gia sửa máy tính. Hãy phân tích lỗi sau và trả về MỘT ĐỐI TƯỢNG JSON hợp lệ (không markdown, không giải thích, chỉ JSON):

{
  "intent": "repair",
  "device": "pc",
  "issue": "no_power",
  "suggestion": "Kiểm tra nguồn điện, dây nguồn, nút nguồn."
}

Quy tắc:
- intent: "repair" nếu cần sửa chữa, "optimize" nếu cần tối ưu
- device: "pc" hoặc "laptop"
- issue: "no_power" (không nguồn), "slow" (chậm), "virus" (nhiễm virus), "blue_screen" (màn hình xanh), "other" (khác)
- suggestion: hướng xử lý ngắn gọn bằng tiếng Việt (1-2 câu)

Lỗi cần phân tích: "${text}"

CHỈ TRẢ VỀ JSON, KHÔNG THÊM BẤT CỨ THỨ GÌ KHÁC.`;

  try {
    console.log("📤 Gửi request đến Gemini-1.0-pro...");
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    let content = response.text();
    
    console.log("📥 Gemini raw response:", content);

    // Xử lý response - loại bỏ markdown và khoảng trắng thừa
    content = content.replace(/```json|```|`/g, "").trim();
    
    // Tìm JSON trong response (nếu có text thừa)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    let parsed;
    
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
        console.log("✅ Parsed JSON from Gemini:", parsed);
        
        // Validate cấu trúc JSON
        if (!parsed.intent || !parsed.device || !parsed.issue || !parsed.suggestion) {
          throw new Error("Thiếu trường dữ liệu trong JSON");
        }
        
        const service = SERVICE_MAP[parsed.issue] || SERVICE_MAP.other;
        
        return res.json({ 
          success: true, 
          ai: parsed, 
          service 
        });
        
      } catch (e) {
        console.error("❌ JSON parse error:", e.message);
        // Nếu parse lỗi, chuyển sang xử lý thông minh
      }
    }
    
    // Xử lý thông minh khi Gemini không trả về JSON đúng format
    console.log("⚠️ Gemini không trả về JSON, xử lý thông minh...");
    
    let intent = "repair";
    let device = "pc";
    let issue = "other";
    let suggestion = "Vui lòng gọi 0900 000 000 để được tư vấn trực tiếp.";
    
    // Phân tích text response từ Gemini để lấy thông tin
    const lowerContent = content.toLowerCase();
    const lowerText = text.toLowerCase();
    
    // Xác định issue dựa trên nội dung
    if (lowerText.includes("không lên") || lowerText.includes("không nguồn") || lowerContent.includes("nguồn")) {
      issue = "no_power";
      suggestion = "Kiểm tra nguồn điện, dây nguồn, nút nguồn. Nếu vẫn không lên, có thể do mainboard.";
    } else if (lowerText.includes("chậm") || lowerText.includes("đơ") || lowerContent.includes("chậm")) {
      issue = "slow";
      intent = "optimize";
      suggestion = "Vệ sinh quạt tản nhiệt, tối ưu Windows, nâng cấp RAM hoặc SSD nếu cần.";
    } else if (lowerText.includes("virus") || lowerContent.includes("virus")) {
      issue = "virus";
      suggestion = "Quét virus bằng phần mềm diệt virus, cài lại Windows nếu nặng.";
    } else if (lowerText.includes("xanh") || lowerContent.includes("xanh") || lowerContent.includes("blue screen")) {
      issue = "blue_screen";
      suggestion = "Kiểm tra driver mới cài, gỡ phần mềm xung đột, khôi phục hệ thống.";
    } else if (content.length > 20) {
      // Nếu có response từ Gemini nhưng không parse được, dùng luôn suggestion từ Gemini
      suggestion = content.substring(0, 150).replace(/[{}"']/g, "").trim();
    }
    
    const aiResponse = {
      intent,
      device,
      issue,
      suggestion
    };
    
    console.log("✅ AI response (processed):", aiResponse);
    
    const service = SERVICE_MAP[issue] || SERVICE_MAP.other;
    
    return res.json({ 
      success: true, 
      ai: aiResponse, 
      service 
    });

  } catch (err) {
    console.error("🔥 Gemini error:", err.message);
    console.error("📚 Stack trace:", err.stack);
    
    // Fallback cuối cùng khi Gemini hoàn toàn không hoạt động
    const fallbackSolutions = {
      "no_power": {
        intent: "repair",
        device: "pc",
        issue: "no_power",
        suggestion: "Kiểm tra nguồn điện, dây nguồn, nút nguồn. Nếu vẫn không lên, có thể do mainboard hoặc nguồn hỏng."
      },
      "slow": {
        intent: "optimize",
        device: "pc",
        issue: "slow",
        suggestion: "Vệ sinh quạt tản nhiệt, tối ưu Windows, nâng cấp RAM hoặc SSD nếu cần."
      },
      "virus": {
        intent: "repair",
        device: "pc",
        issue: "virus",
        suggestion: "Quét virus bằng phần mềm diệt virus, cài lại Windows nếu nặng."
      },
      "blue_screen": {
        intent: "repair",
        device: "pc",
        issue: "blue_screen",
        suggestion: "Kiểm tra driver mới cài, gỡ phần mềm xung đột, khởi động vào Safe Mode."
      },
      "other": {
        intent: "repair",
        device: "pc",
        issue: "other",
        suggestion: "Vui lòng gọi 0900 000 000 để được tư vấn trực tiếp."
      }
    };
    
    // Xác định issue dựa trên text gốc
    let issue = "other";
    if (text.includes("không lên") || text.includes("không nguồn")) issue = "no_power";
    else if (text.includes("chậm") || text.includes("đơ")) issue = "slow";
    else if (text.includes("virus")) issue = "virus";
    else if (text.includes("xanh")) issue = "blue_screen";
    
    const fallbackAI = fallbackSolutions[issue];
    
    return res.json({ 
      success: true, 
      ai: fallbackAI,
      service: SERVICE_MAP[issue] || SERVICE_MAP.other,
      note: "Gemini đang gặp sự cố, dùng chế độ dự phòng"
    });
  }
});

// =============================
// CREATE BOOKING
// =============================
app.post("/booking", async (req, res) => {
  try {
    const item = await Booking.create({
      ...req.body,
      status: "new",
      created_at: new Date()
    });
    console.log("✅ Booking created:", item._id);
    res.json({ success: true, data: item });
  } catch (err) {
    console.error("❌ Booking error:", err.message);
    res.json({ success: false, error: err.message });
  }
});

// =============================
// GET BOOKINGS
// =============================
app.get("/bookings", async (req, res) => {
  try {
    const data = await Booking.find().sort({ created_at: -1 });
    res.json(data);
  } catch (err) {
    console.error("❌ Get bookings error:", err.message);
    res.json({ success: false, error: err.message });
  }
});

// =============================
// UPDATE STATUS
// =============================
app.post("/booking/update", async (req, res) => {
  const { id, status } = req.body;
  try {
    await Booking.findByIdAndUpdate(id, { status });
    console.log("✅ Booking updated:", id, status);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Update error:", err.message);
    res.json({ success: false, error: err.message });
  }
});

// =============================
// HEALTH CHECK
// =============================
app.get("/", (req, res) => {
  res.send("IT Repair CRM API running with Gemini 🚀");
});

// =============================
// 404 HANDLER
// =============================
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    error: "Endpoint not found",
    method: req.method,
    path: req.url
  });
});

// =============================
// START SERVER
// =============================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});