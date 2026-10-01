import { GoogleGenAI } from '@google/genai';
import { PEOPLE_CHECK_PROMPT, NO_PEOPLE_RULE } from './prompts.js';

// Nano-Banana is Google's Gemini 2.5 Flash Image model. Every image in the app
// is produced by this model — it is intentionally not configurable.
export const IMAGE_MODEL = 'gemini-2.5-flash-image';

// Lightweight vision model used only to *verify* that no people slipped into an image.
const CHECK_MODEL = process.env.PEOPLE_CHECK_MODEL || 'gemini-2.5-flash';
const MAX_ATTEMPTS = 3;

export const isMock = () => process.env.MOCK === '1';
const peopleCheckEnabled = () => process.env.PEOPLE_CHECK !== '0';

let client;
function ai() {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      const err = new Error('GEMINI_API_KEY is not set. Add it to .env (see .env.example) and restart the server.');
      err.status = 500;
      throw err;
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

/** Extract the first image part from a generateContent response. */
function firstImage(response) {
  const parts = response?.candidates?.[0]?.content?.parts ?? [];
  const img = parts.find((p) => p.inlineData?.data);
  if (!img) {
    const text = parts.map((p) => p.text).filter(Boolean).join(' ');
    const reason = response?.candidates?.[0]?.finishReason || response?.promptFeedback?.blockReason;
    throw new Error(`Nano-Banana returned no image${reason ? ` (${reason})` : ''}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
  return { mimeType: img.inlineData.mimeType || 'image/png', data: img.inlineData.data };
}

async function callNanoBanana({ prompt, referenceImage, aspectRatio }) {
  const parts = [{ text: prompt }];
  if (referenceImage) parts.push({ inlineData: { mimeType: referenceImage.mimeType, data: referenceImage.data } });

  const response = await ai().models.generateContent({
    model: IMAGE_MODEL,
    contents: [{ role: 'user', parts }],
    config: {
      responseModalities: ['IMAGE'],
      imageConfig: aspectRatio ? { aspectRatio } : undefined,
    },
  });
  return firstImage(response);
}

/** Returns true if the vision model thinks the image contains people. */
export async function containsPeople(image) {
  const response = await ai().models.generateContent({
    model: CHECK_MODEL,
    contents: [{ role: 'user', parts: [{ inlineData: image }, { text: PEOPLE_CHECK_PROMPT }] }],
    config: { temperature: 0 },
  });
  return /^\s*yes/i.test(response.text ?? '');
}

/**
 * Generate an image with Nano-Banana, re-rolling if the people check fails.
 * Returns { image, attempts, peopleCheck: 'passed' | 'skipped' | 'unverified' | 'failed' }.
 */
export async function generateImage({ prompt, referenceImage, aspectRatio, label = 'image' }) {
  if (isMock()) return { image: mockImage(label, aspectRatio), attempts: 1, peopleCheck: 'skipped' };

  let lastImage;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const p =
      attempt === 1
        ? prompt
        : `${prompt}\n\nIMPORTANT: a previous attempt wrongly included a person. Remove every trace of humans. ${NO_PEOPLE_RULE}`;
    lastImage = await callNanoBanana({ prompt: p, referenceImage, aspectRatio });

    if (!peopleCheckEnabled()) return { image: lastImage, attempts: attempt, peopleCheck: 'skipped' };

    let hasPeople;
    try {
      hasPeople = await containsPeople(lastImage);
    } catch (err) {
      console.warn(`[people-check] ${label}: check unavailable (${err.message}); keeping image`);
      return { image: lastImage, attempts: attempt, peopleCheck: 'unverified' };
    }
    if (!hasPeople) return { image: lastImage, attempts: attempt, peopleCheck: 'passed' };
    console.warn(`[people-check] ${label}: person detected on attempt ${attempt}, regenerating`);
  }
  const err = new Error(`Could not produce a people-free ${label} after ${MAX_ATTEMPTS} attempts. Try regenerating.`);
  err.status = 422;
  throw err;
}

// --- Mock mode -------------------------------------------------------------

function mockImage(label, aspectRatio = '1:1') {
  const [w, h] = aspectRatio.split(':').map(Number);
  const W = 960;
  const H = Math.round((W * h) / w);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f2a44"/><stop offset="1" stop-color="#c2553d"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <rect x="${W / 2 - 60}" y="${H / 2 - 110}" width="120" height="220" rx="28" fill="#f4efe6"/>
  <text x="50%" y="${H - 40}" fill="#fff" font-family="sans-serif" font-size="36" text-anchor="middle">MOCK · ${label} · ${aspectRatio}</text>
</svg>`;
  return { mimeType: 'image/svg+xml', data: Buffer.from(svg).toString('base64') };
}
