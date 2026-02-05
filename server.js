import express from 'express';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

const POE_API_KEY = process.env.POE_API_KEY;
const POE_BASE_URL = 'https://api.poe.com/v1';

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Flashcard Schema
const flashcardSchema = new mongoose.Schema({
  polish: { type: String, required: true },
  russian: { type: String, required: true },
  baseForm: String,
  example: String,
  createdAt: { type: Date, default: Date.now },
  stats: {
    correct: { type: Number, default: 0 },
    incorrect: { type: Number, default: 0 },
    lastReview: Date
  }
});

const Flashcard = mongoose.model('Flashcard', flashcardSchema);

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
    throw new Error(`Poe API error: ${response.status} ${error}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// Генерация текста на польском по теме
app.post('/api/generate', async (req, res) => {
  const { topic } = req.body;

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
    res.status(500).json({ error: 'Failed to generate text', details: error.message });
  }
});

// Перевод слова или фразы с контекстом
app.post('/api/translate', async (req, res) => {
  const { word, context } = req.body;

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
    res.status(500).json({ error: 'Failed to translate', details: error.message });
  }
});

// Получить все флешкарточки
app.get('/api/flashcards', async (req, res) => {
  try {
    const cards = await Flashcard.find().sort({ createdAt: -1 });
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
  const { polish, russian, example, baseForm } = req.body;

  if (!polish || !russian) {
    return res.status(400).json({ error: 'Polish and Russian are required' });
  }

  try {
    // Проверяем, нет ли уже такой карточки
    const exists = await Flashcard.findOne({
      polish: { $regex: new RegExp(`^${polish}$`, 'i') }
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

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
