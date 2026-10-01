import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MEDIUMS, MEDIUM_BY_ID, normaliseBrief, referencePrompt, mediumPrompt } from './lib/prompts.js';
import { generateImage, IMAGE_MODEL, isMock } from './lib/gemini.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);

function parseImage(img) {
  if (!img || typeof img.data !== 'string' || !ALLOWED_MIME.has(img.mimeType)) {
    const err = new Error('A valid product reference image is required.');
    err.status = 400;
    throw err;
  }
  return { mimeType: img.mimeType, data: img.data };
}

app.get('/api/config', (_req, res) => {
  res.json({
    model: IMAGE_MODEL,
    mock: isMock(),
    mediums: MEDIUMS.map(({ id, label, aspectRatio }) => ({ id, label, aspectRatio })),
  });
});

// Step 1: the master product shot that every medium is anchored to.
app.post(
  '/api/reference',
  async (req, res) => {
    const brief = normaliseBrief(req.body?.brief);
    const result = await generateImage({ prompt: referencePrompt(brief), aspectRatio: '1:1', label: 'reference' });
    res.json(result);
  },
);

// Step 2: one medium at a time, always fed the same reference image.
app.post(
  '/api/medium',
  async (req, res) => {
    const brief = normaliseBrief(req.body?.brief);
    const medium = MEDIUM_BY_ID[req.body?.mediumId];
    if (!medium) return res.status(400).json({ error: 'Unknown medium.' });
    const referenceImage = parseImage(req.body?.referenceImage);
    const result = await generateImage({
      prompt: mediumPrompt(brief, medium, { variationNote: req.body?.variationNote }),
      referenceImage,
      aspectRatio: medium.aspectRatio,
      label: medium.label,
    });
    res.json({ mediumId: medium.id, ...result });
  },
);

app.use((err, _req, res, _next) => {
  const status = err.status && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Something went wrong.' });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Brand Builder running at http://localhost:${port} (image model: ${IMAGE_MODEL}${isMock() ? ', MOCK mode' : ''})`);
});
