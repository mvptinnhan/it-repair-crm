// server.js (DYNAMIC PROMPT VERSION)
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
// INIT GEMINI
// =============================
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
  model: "gemini-2.5-flash",
  generationConfig: {
    temperature: 0.1,
    maxOutputTokens: 800,
  }
});

// =============================
// CONNECT DATABASE
// =============================
mongoose.connect(MONGO_URL)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.log("❌ MongoDB error:", err));

// =============================
// SERVICE SCHEMA
// =============================
const ServiceSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  category: String,
  device_type: [String],
  keywords: [String],
  symptoms: [String],
  solutions: [String],
  price_range: {
    min: Number,
    max: Number,
    unit: String
  },
  estimated_time: String,
  warranty: String,
  active: { type: Boolean, default: true }
});

const Service = mongoose.model("Service", ServiceSchema);

// =============================
// BOOKING SCHEMA
// =============================
const BookingSchema = new mongoose.Schema({
  name: String,
  phone: String,
  issue: String,
  service_code: String,
  service_name: String,
  status: String,
  created_at: Date
});

const Booking = mongoose.model("Booking", BookingSchema);

// =============================
// MIDDLEWARE
// =============================
app.use((req, res, next) => {
  console.log(`📨 ${new Date().toISOString()} - ${req.method} ${req.url}`);
  if (req.method === 'POST') {
    console.log("📦 Body:", req.body);
  }
  next();
});

// =============================
// API: GET ALL SERVICES
// =============================
app.get("/api/services", async (req, res) => {
  const services = await Service.find({ active: true });
  res.json(services);
});

// =============================
// API: ADD NEW SERVICE (ADMIN)
// =============================
app.post("/api/services", async (req, res) => {
  try {
    const service = await Service.create(req.body);
    console.log("✅ New service added:", service.code);
    res.json({ success: true, data: service });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// =============================
// AI ANALYZE WITH DYNAMIC PROMPT
// =============================
app.post("/analyze", async (req, res) => {
  const { text } = req.body;
  
  console.log("🎯 /analyze POST hit at", new Date().toISOString());
  console.log("📝 Input text:", text);

  if (!text) {
    return res.json({ success: false, error: "Missing text input" });
  }

  try {
    // Lấy danh sách dịch vụ từ database
    const services = await Service.find({ active: true });
    
    // Xây dựng dynamic prompt
    const serviceList = services.map(s => {
      return `- "${s.code}": ${s.name}
  • Thiết bị: ${s.device_type.join(", ")}
  • Từ khóa: ${s.keywords.join(", ")}
  • Triệu chứng: ${s.symptoms.join(", ")}
  • Giải pháp: ${s.solutions[0] || "..."}
  • Giá: ${s.price_range.min}${s.price_range.unit} - ${s.price_range.max}${s.price_range.unit}
  • Thời gian: ${s.estimated_time || "1-2 giờ"}`;
    }).join("\n\n");

    const prompt = `Bạn là chuyên gia sửa chữa thiết bị văn phòng. Hãy phân tích lỗi và trả về JSON với cấu trúc:

{
  "service_code": "MÃ_DỊCH_VỤ",
  "confidence": 0.95,
  "device_type": "pc",
  "explanation": "Giải thích ngắn gọn",
  "suggestion": "Hướng xử lý chi tiết"
}

DANH SÁCH DỊCH VỤ HIỆN CÓ:
${serviceList}

QUY TẮC:
1. Chọn service_code phù hợp nhất dựa trên triệu chứng và từ khóa
2. confidence: độ tin cậy (0-1)
3. device_type: loại thiết bị
4. explanation: giải thích tại sao chọn dịch vụ này
5. suggestion: đề xuất cụ thể cho khách hàng

LỖI CẦN PHÂN TÍCH: "${text}"

CHỈ TRẢ VỀ JSON HỢP LỆ, KHÔNG THÊM GIẢI THÍCH.`;

    console.log("📤 Gửi request đến Gemini với dynamic prompt...");
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    let content = response.text();
    
    console.log("📥 Gemini raw response:", content);

    // Parse JSON từ response
    content = content.replace(/```json|```/g, "").trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log("✅ Parsed JSON:", parsed);
      
      // Tìm service tương ứng
      const matchedService = services.find(s => s.code === parsed.service_code);
      
      if (matchedService) {
        return res.json({
          success: true,
          ai: {
            intent: matchedService.category === "software" ? "repair" : "maintenance",
            device: parsed.device_type,
            issue: matchedService.code,
            suggestion: parsed.suggestion || matchedService.solutions[0]
          },
          service: {
            name: matchedService.name,
            price: `${matchedService.price_range.min}${matchedService.price_range.unit} - ${matchedService.price_range.max}${matchedService.price_range.unit}`,
            estimated_time: matchedService.estimated_time,
            warranty: matchedService.warranty
          },
          confidence: parsed.confidence,
          explanation: parsed.explanation
        });
      }
    }
    
    // Fallback khi không match
    return handleFallback(text, res, services);

  } catch (err) {
    console.error("🔥 Gemini error:", err.message);
    return handleFallback(text, res, []);
  }
});

// =============================
// FALLBACK HANDLER
// =============================
async function handleFallback(text, res, services) {
  const lowerText = text.toLowerCase();
  
  // Tìm service dựa trên keywords
  let matchedService = null;
  for (const service of services) {
    if (service.keywords.some(keyword => lowerText.includes(keyword))) {
      matchedService = service;
      break;
    }
  }
  
  if (matchedService) {
    return res.json({
      success: true,
      ai: {
        intent: matchedService.category === "software" ? "repair" : "maintenance",
        device: matchedService.device_type[0] || "pc",
        issue: matchedService.code,
        suggestion: matchedService.solutions[0] || "Vui lòng gọi 0900 000 000 để được tư vấn."
      },
      service: {
        name: matchedService.name,
        price: `${matchedService.price_range.min}${matchedService.price_range.unit} - ${matchedService.price_range.max}${matchedService.price_range.unit}`,
        estimated_time: matchedService.estimated_time,
        warranty: matchedService.warranty
      },
      note: "Phân tích từ database"
    });
  }
  
  // Default fallback
  return res.json({
    success: true,
    ai: {
      intent: "repair",
      device: "pc",
      issue: "other",
      suggestion: "Vui lòng gọi 0900 000 000 để được tư vấn chi tiết."
    },
    service: {
      name: "Kiểm tra và tư vấn",
      price: "Liên hệ",
      estimated_time: "Theo thỏa thuận",
      warranty: "Theo dịch vụ"
    }
  });
}

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
  const data = await Booking.find().sort({ created_at: -1 });
  res.json(data);
});

// =============================
// UPDATE BOOKING STATUS
// =============================
app.post("/booking/update", async (req, res) => {
  const { id, status } = req.body;
  await Booking.findByIdAndUpdate(id, { status });
  res.json({ success: true });
});

// =============================
// HEALTH CHECK
// =============================
app.get("/", (req, res) => {
  res.send("IT Repair CRM API running with Dynamic Prompt 🚀");
});

// =============================
// INIT SAMPLE SERVICES
// =============================
async function initSampleServices() {
  const count = await Service.countDocuments();
  if (count === 0) {
    console.log("📦 Creating sample services...");
    
    const sampleServices = [
      {
        code: "no_power",
        name: "Sửa máy không lên nguồn",
        category: "hardware",
        device_type: ["pc", "laptop"],
        keywords: ["không lên", "không nguồn", "chết nguồn", "bấm nút không chạy"],
        symptoms: ["Không có đèn nguồn", "Quạt không quay", "Máy không phản hồi"],
        solutions: ["Kiểm tra nguồn điện", "Kiểm tra nút nguồn", "Kiểm tra mainboard"],
        price_range: { min: 200, max: 800, unit: "k" },
        estimated_time: "1-3 giờ",
        warranty: "30 ngày"
      },
      {
        code: "slow",
        name: "Tối ưu hiệu suất máy tính",
        category: "software",
        device_type: ["pc", "laptop"],
        keywords: ["chậm", "đơ", "lag", "giật", "nặng máy"],
        symptoms: ["Máy chạy chậm", "Mở ứng dụng lâu", "Khởi động lâu"],
        solutions: ["Vệ sinh phần mềm", "Tối ưu Windows", "Nâng cấp RAM/SSD"],
        price_range: { min: 100, max: 400, unit: "k" },
        estimated_time: "1-2 giờ",
        warranty: "15 ngày"
      },
      {
        code: "printer_jam",
        name: "Sửa máy in kẹt giấy",
        category: "maintenance",
        device_type: ["printer"],
        keywords: ["kẹt giấy", "mắc kẹt", "giấy không ra", "nhai giấy"],
        symptoms: ["Giấy không ra", "Máy báo lỗi kẹt giấy", "Tiếng kêu lạ"],
        solutions: ["Lấy giấy kẹt", "Vệ sinh lô kéo giấy", "Thay lô cao su"],
        price_range: { min: 150, max: 400, unit: "k" },
        estimated_time: "30-60 phút",
        warranty: "7 ngày"
      },
      {
        code: "virus",
        name: "Diệt virus và malware",
        category: "software",
        device_type: ["pc", "laptop"],
        keywords: ["virus", "malware", "nhiễm độc", "quảng cáo", "chậm đột ngột"],
        symptoms: ["Máy chạy chậm bất thường", "Xuất hiện quảng cáo", "Tự động mở web"],
        solutions: ["Quét toàn bộ hệ thống", "Diệt virus", "Cài lại Windows nếu nặng"],
        price_range: { min: 150, max: 350, unit: "k" },
        estimated_time: "1-3 giờ",
        warranty: "30 ngày"
      },
      {
        code: "printer_faint",
        name: "Sửa máy in bị mờ",
        category: "maintenance",
        device_type: ["printer"],
        keywords: ["in mờ", "nhạt", "không rõ", "lờ mờ"],
        symptoms: ["Chữ in nhạt", "Hình ảnh mờ", "Không đều mực"],
        solutions: ["Thay mực", "Vệ sinh đầu in", "Thay trống"],
        price_range: { min: 200, max: 500, unit: "k" },
        estimated_time: "30-60 phút",
        warranty: "7 ngày"
      }
    ];
    
    await Service.insertMany(sampleServices);
    console.log("✅ Sample services created");
  }
}

// =============================
// START SERVER
// =============================
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  await initSampleServices();
});