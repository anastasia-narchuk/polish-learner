import express from 'express';
import mongoose from 'mongoose';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
    },
  },
}));

app.use(express.json({ limit: '50kb' })); // Увеличено для поддержки импорта текстов
app.use(express.static(join(__dirname, 'public')));

// Rate limiters
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 100, // максимум 100 запросов за 15 минут
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const generateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 минута
  max: 5, // максимум 5 генераций в минуту
  message: { error: 'Too many generation requests, please wait a minute' },
});

const translateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 минута
  max: 30, // максимум 30 переводов в минуту
  message: { error: 'Too many translation requests, please wait' },
});

const importLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  message: { error: 'Too many import requests, please wait a minute' },
});

// Apply rate limiting
app.use('/api/', apiLimiter);

const POE_API_KEY = process.env.POE_API_KEY;
const POE_BASE_URL = 'https://api.poe.com/v1';

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Flashcard Schema
const flashcardSchema = new mongoose.Schema({
  polish: { type: String, required: true, maxlength: 500 },
  russian: { type: String, required: true, maxlength: 500 },
  baseForm: { type: String, maxlength: 500 },
  example: { type: String, maxlength: 1000 },
  createdAt: { type: Date, default: Date.now },
  stats: {
    correct: { type: Number, default: 0 },
    incorrect: { type: Number, default: 0 },
    lastReview: Date
  }
});

const Flashcard = mongoose.model('Flashcard', flashcardSchema);

// Unrecognized Word Schema (for words AI couldn't process from messy notes)
const unrecognizedWordSchema = new mongoose.Schema({
  text: { type: String, required: true, maxlength: 200 },
  sourceContext: { type: String, maxlength: 2000 },
  aiNote: { type: String, maxlength: 500 },
  status: {
    type: String,
    enum: ['pending', 'resolved', 'dismissed'],
    default: 'pending'
  },
  createdAt: { type: Date, default: Date.now }
});

const UnrecognizedWord = mongoose.model('UnrecognizedWord', unrecognizedWordSchema);

// Validation helpers
function sanitizeString(str, maxLength = 500) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLength);
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// Helper function to call Poe API (OpenAI-compatible)
async function callPoeAPI(messages, maxTokens = 1024) {
  const response = await fetch(`${POE_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${POE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'Claude-3.5-Sonnet',
      messages: messages,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Poe API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// AI Prompt builders for import feature
function buildBatchTranslatePrompt(words) {
  return `Переведи следующие польские слова на русский.

Слова: ${words.join(', ')}

Для каждого слова дай:
- polish: слово в правильном написании (исправь опечатки если есть)
- russian: перевод на русский
- baseForm: базовая/словарная форма (инфинитив для глаголов, именительный падеж для существительных)
- example: короткий пример предложения на польском (5-8 слов)

Формат ответа — JSON массив:
[
  {"polish": "kot", "russian": "кот", "baseForm": "kot", "example": "Mój kot śpi na kanapie."}
]

ВАЖНО:
- Если слово уже в базовой форме, baseForm = polish
- Если слово не является польским, всё равно включи его с пометкой в russian: "(не польское слово)"
- Верни ТОЛЬКО JSON массив, без дополнительного текста.`;
}

function buildMessyNotesPrompt(text) {
  return `Проанализируй следующие заметки с урока польского языка. Текст может содержать:
- Польские слова (возможно с опечатками)
- Русские переводы
- Случайное форматирование, пунктуацию, числа

Текст заметок:
"""
${text}
"""

Задача:
1. ИЗВЛЕКИ все польские слова/фразы из заметок
2. ИСПРАВЬ опечатки в польских словах
3. ПЕРЕВЕДИ каждое на русский
4. ОТМЕТЬ слова которые не удалось распознать

Формат ответа — JSON объект:
{
  "cards": [
    {
      "polish": "правильное польское написание",
      "russian": "перевод на русский",
      "baseForm": "базовая форма",
      "example": "пример предложения на польском",
      "originalText": "как было написано в заметках"
    }
  ],
  "unrecognized": [
    {
      "text": "нераспознанное слово",
      "note": "причина (не польское, не удалось определить значение и т.д.)"
    }
  ],
  "warnings": [
    "Исправлено: 'szkola' → 'szkoła'",
    "Пропущено русское слово: 'собака'"
  ]
}

ВАЖНО:
- НЕ включай русские слова как польские карточки
- Если слово может быть и русским и польским, проверь по контексту
- Включай ТОЛЬКО уникальные слова (без повторов)
- Верни ТОЛЬКО JSON, без дополнительного текста.`;
}

// Генерация текста на польском по теме
app.post('/api/generate', generateLimiter, async (req, res) => {
  const topic = sanitizeString(req.body.topic, 200);

  if (!topic) {
    return res.status(400).json({ error: 'Topic is required' });
  }

  try {
    const text = await callPoeAPI([
      {
        role: 'user',
        content: `Напиши короткий текст на польском языке (100-150 слов) на тему: "${topic}".

Требования:
- Уровень сложности: A2-B1 (простые предложения, базовая лексика)
- Текст должен быть связным и интересным
- Используй повседневную лексику
- Избегай сложных грамматических конструкций

Верни ТОЛЬКО текст на польском, без перевода и комментариев.`
      }
    ]);

    res.json({ text });
  } catch (error) {
    console.error('Error generating text:', error.message);
    res.status(500).json({ error: 'Failed to generate text' });
  }
});

// Перевод слова или фразы с контекстом
app.post('/api/translate', translateLimiter, async (req, res) => {
  const word = sanitizeString(req.body.word, 200);
  const context = sanitizeString(req.body.context, 2000);

  if (!word) {
    return res.status(400).json({ error: 'Word is required' });
  }

  try {
    const contextPrompt = context
      ? `Контекст (полный текст): "${context}"\n\n`
      : '';

    const responseText = await callPoeAPI([
      {
        role: 'user',
        content: `${contextPrompt}Переведи с польского на русский: "${word}"

Формат ответа (JSON):
{
  "translation": "перевод",
  "baseForm": "базовая форма слова (если это глагол/существительное в падеже)",
  "partOfSpeech": "часть речи",
  "note": "краткое пояснение если нужно (необязательно)"
}

Верни ТОЛЬКО JSON без дополнительного текста.`
      }
    ], 512);

    // Пробуем распарсить JSON
    try {
      const parsed = JSON.parse(responseText);
      res.json(parsed);
    } catch {
      // Если не получилось распарсить, возвращаем как есть
      res.json({ translation: responseText, baseForm: word });
    }
  } catch (error) {
    console.error('Error translating:', error.message);
    res.status(500).json({ error: 'Failed to translate' });
  }
});

// Получить все флешкарточки
app.get('/api/flashcards', async (req, res) => {
  try {
    const cards = await Flashcard.find().sort({ createdAt: -1 }).limit(500);
    // Преобразуем _id в id для совместимости с фронтендом
    const cardsWithId = cards.map(card => ({
      id: card._id.toString(),
      polish: card.polish,
      russian: card.russian,
      baseForm: card.baseForm,
      example: card.example,
      createdAt: card.createdAt,
      stats: card.stats
    }));
    res.json(cardsWithId);
  } catch (error) {
    console.error('Error loading flashcards:', error);
    res.status(500).json({ error: 'Failed to load flashcards' });
  }
});

// Добавить флешкарточку
app.post('/api/flashcards', async (req, res) => {
  const polish = sanitizeString(req.body.polish, 500);
  const russian = sanitizeString(req.body.russian, 500);
  const example = sanitizeString(req.body.example, 1000);
  const baseForm = sanitizeString(req.body.baseForm, 500);

  if (!polish || !russian) {
    return res.status(400).json({ error: 'Polish and Russian are required' });
  }

  try {
    // Безопасный поиск (экранирование спецсимволов)
    const exists = await Flashcard.findOne({
      polish: { $regex: new RegExp(`^${escapeRegex(polish)}$`, 'i') }
    });

    if (exists) {
      return res.status(409).json({ error: 'Card already exists' });
    }

    const newCard = new Flashcard({
      polish,
      russian,
      baseForm: baseForm || polish,
      example: example || ''
    });

    await newCard.save();

    res.status(201).json({
      id: newCard._id.toString(),
      polish: newCard.polish,
      russian: newCard.russian,
      baseForm: newCard.baseForm,
      example: newCard.example,
      createdAt: newCard.createdAt,
      stats: newCard.stats
    });
  } catch (error) {
    console.error('Error adding flashcard:', error);
    res.status(500).json({ error: 'Failed to add flashcard' });
  }
});

// Удалить флешкарточку
app.delete('/api/flashcards/:id', async (req, res) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid ID format' });
  }

  try {
    const result = await Flashcard.findByIdAndDelete(id);

    if (!result) {
      return res.status(404).json({ error: 'Card not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting flashcard:', error);
    res.status(500).json({ error: 'Failed to delete flashcard' });
  }
});

// Обновить статистику карточки
app.patch('/api/flashcards/:id/stats', async (req, res) => {
  const { id } = req.params;
  const { correct } = req.body;

  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid ID format' });
  }

  if (typeof correct !== 'boolean') {
    return res.status(400).json({ error: 'Invalid correct value' });
  }

  try {
    const update = correct
      ? { $inc: { 'stats.correct': 1 }, $set: { 'stats.lastReview': new Date() } }
      : { $inc: { 'stats.incorrect': 1 }, $set: { 'stats.lastReview': new Date() } };

    const card = await Flashcard.findByIdAndUpdate(id, update, { new: true });

    if (!card) {
      return res.status(404).json({ error: 'Card not found' });
    }

    res.json({
      id: card._id.toString(),
      polish: card.polish,
      russian: card.russian,
      baseForm: card.baseForm,
      example: card.example,
      createdAt: card.createdAt,
      stats: card.stats
    });
  } catch (error) {
    console.error('Error updating stats:', error);
    res.status(500).json({ error: 'Failed to update stats' });
  }
});

// ========================================
// Import Feature Endpoints
// ========================================

// Parse and translate bulk words (Modes 1-2: comma-separated / one-per-line)
app.post('/api/import/parse', importLimiter, async (req, res) => {
  const { words } = req.body;

  if (!Array.isArray(words) || words.length === 0) {
    return res.status(400).json({ error: 'Words array is required' });
  }
  if (words.length > 50) {
    return res.status(400).json({ error: 'Maximum 50 words per import' });
  }

  const cleanWords = words
    .map(w => sanitizeString(w, 100))
    .filter(w => w.length > 0);

  if (cleanWords.length === 0) {
    return res.status(400).json({ error: 'No valid words provided' });
  }

  try {
    // Check for existing duplicates in DB
    const regexQueries = cleanWords.map(w => new RegExp(`^${escapeRegex(w)}$`, 'i'));
    const existingCards = await Flashcard.find({
      polish: { $in: regexQueries }
    });
    const existingPolish = new Set(existingCards.map(c => c.polish.toLowerCase()));

    const newWords = cleanWords.filter(w => !existingPolish.has(w.toLowerCase()));
    const duplicates = cleanWords.filter(w => existingPolish.has(w.toLowerCase()));

    if (newWords.length === 0) {
      return res.json({ proposed: [], duplicates, errors: [] });
    }

    // Single AI call for all new words
    const aiResponse = await callPoeAPI([
      { role: 'user', content: buildBatchTranslatePrompt(newWords) }
    ], 2048);

    let proposed = [];
    try {
      proposed = JSON.parse(aiResponse);
    } catch {
      return res.status(500).json({ error: 'Failed to parse AI response' });
    }

    if (!Array.isArray(proposed)) {
      return res.status(500).json({ error: 'Invalid AI response format' });
    }

    // Sanitize AI output
    proposed = proposed.map(card => ({
      polish: sanitizeString(card.polish, 500),
      russian: sanitizeString(card.russian, 500),
      baseForm: sanitizeString(card.baseForm || card.polish, 500),
      example: sanitizeString(card.example || '', 1000),
    }));

    res.json({ proposed, duplicates, errors: [] });
  } catch (error) {
    console.error('Import parse error:', error.message);
    res.status(500).json({ error: 'Failed to process import' });
  }
});

// Extract Polish words from messy notes (Mode 3)
app.post('/api/import/notes', importLimiter, async (req, res) => {
  const text = sanitizeString(req.body.text, 5000);

  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }

  try {
    const aiResponse = await callPoeAPI([
      { role: 'user', content: buildMessyNotesPrompt(text) }
    ], 3000);

    let parsed;
    try {
      parsed = JSON.parse(aiResponse);
    } catch {
      return res.status(500).json({ error: 'Failed to parse AI response' });
    }

    const cards = parsed.cards || [];
    const unrecognized = parsed.unrecognized || [];
    const warnings = parsed.warnings || [];

    // Deduplicate proposed cards against existing DB flashcards
    const polishWords = cards.map(c => c.polish).filter(Boolean);
    let existingPolish = new Set();
    if (polishWords.length > 0) {
      const regexQueries = polishWords.map(w => new RegExp(`^${escapeRegex(w)}$`, 'i'));
      const existingCards = await Flashcard.find({ polish: { $in: regexQueries } });
      existingPolish = new Set(existingCards.map(c => c.polish.toLowerCase()));
    }

    const proposed = cards
      .filter(c => c.polish && !existingPolish.has(c.polish.toLowerCase()))
      .map(card => ({
        polish: sanitizeString(card.polish, 500),
        russian: sanitizeString(card.russian, 500),
        baseForm: sanitizeString(card.baseForm || card.polish, 500),
        example: sanitizeString(card.example || '', 1000),
        originalText: sanitizeString(card.originalText || '', 200),
      }));

    const duplicates = cards
      .filter(c => c.polish && existingPolish.has(c.polish.toLowerCase()))
      .map(c => c.polish);

    // Store unrecognized words in DB
    if (unrecognized.length > 0) {
      const unrecognizedDocs = unrecognized.map(item => ({
        text: sanitizeString(item.text, 200),
        sourceContext: text.substring(0, 2000),
        aiNote: sanitizeString(item.note, 500),
        status: 'pending'
      }));
      await UnrecognizedWord.insertMany(unrecognizedDocs);
    }

    res.json({
      proposed,
      duplicates,
      unrecognized: unrecognized.map(u => ({
        text: sanitizeString(u.text, 200),
        aiNote: sanitizeString(u.note, 500),
      })),
      warnings: warnings.map(w => sanitizeString(w, 500)),
    });
  } catch (error) {
    console.error('Import notes error:', error.message);
    res.status(500).json({ error: 'Failed to process notes' });
  }
});

// Bulk save reviewed flashcards
app.post('/api/flashcards/bulk', importLimiter, async (req, res) => {
  const { cards } = req.body;

  if (!Array.isArray(cards) || cards.length === 0 || cards.length > 50) {
    return res.status(400).json({ error: 'Invalid cards array (1-50 cards required)' });
  }

  const added = [];
  const skipped = [];

  for (const card of cards) {
    const polish = sanitizeString(card.polish, 500);
    const russian = sanitizeString(card.russian, 500);
    const baseForm = sanitizeString(card.baseForm || polish, 500);
    const example = sanitizeString(card.example || '', 1000);

    if (!polish || !russian) {
      skipped.push({ polish: polish || '(empty)', reason: 'missing fields' });
      continue;
    }

    const exists = await Flashcard.findOne({
      polish: { $regex: new RegExp(`^${escapeRegex(polish)}$`, 'i') }
    });

    if (exists) {
      skipped.push({ polish, reason: 'duplicate' });
      continue;
    }

    const newCard = new Flashcard({ polish, russian, baseForm, example });
    await newCard.save();
    added.push({
      id: newCard._id.toString(),
      polish: newCard.polish,
      russian: newCard.russian,
      baseForm: newCard.baseForm,
      example: newCard.example,
      createdAt: newCard.createdAt,
      stats: newCard.stats
    });
  }

  res.status(201).json({
    added,
    skipped,
    count: { added: added.length, skipped: skipped.length }
  });
});

// ========================================
// Unrecognized Words CRUD
// ========================================

// Get all unrecognized words
app.get('/api/unrecognized', async (req, res) => {
  try {
    const words = await UnrecognizedWord.find()
      .sort({ createdAt: -1 })
      .limit(200);
    const result = words.map(w => ({
      id: w._id.toString(),
      text: w.text,
      aiNote: w.aiNote,
      status: w.status,
      createdAt: w.createdAt,
    }));
    res.json(result);
  } catch (error) {
    console.error('Error loading unrecognized words:', error);
    res.status(500).json({ error: 'Failed to load unrecognized words' });
  }
});

// Update unrecognized word status
app.patch('/api/unrecognized/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid ID format' });
  }
  if (!['resolved', 'dismissed'].includes(status)) {
    return res.status(400).json({ error: 'Status must be "resolved" or "dismissed"' });
  }

  try {
    const word = await UnrecognizedWord.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    );

    if (!word) {
      return res.status(404).json({ error: 'Word not found' });
    }

    res.json({
      id: word._id.toString(),
      text: word.text,
      aiNote: word.aiNote,
      status: word.status,
    });
  } catch (error) {
    console.error('Error updating unrecognized word:', error);
    res.status(500).json({ error: 'Failed to update' });
  }
});

// Delete unrecognized word
app.delete('/api/unrecognized/:id', async (req, res) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid ID format' });
  }

  try {
    const result = await UnrecognizedWord.findByIdAndDelete(id);
    if (!result) {
      return res.status(404).json({ error: 'Word not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting unrecognized word:', error);
    res.status(500).json({ error: 'Failed to delete' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
