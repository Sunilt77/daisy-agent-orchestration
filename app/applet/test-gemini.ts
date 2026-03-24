import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
dotenv.config();
async function test() {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.list();
    console.log("Response type:", typeof response);
    console.log("Is array:", Array.isArray(response));
    for await (const m of response) {
      console.log(m.name);
      break;
    }
  } catch (e) {
    console.error("Error:", e);
  }
}
test();
