import express from 'express';
import { readFileSync, writeFileSync, existsSync } from 'fs';
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

const FLASHCARDS_PATH = join(__dirname, 'data', 'flashcards.json');

function loadFlashcards() {
  if (!existsSync(FLASHCARDS_PATH)) {
    return [];
  }
  const data = readFileSync(FLASHCARDS_PATH, 'utf-8');
  return JSON.parse(data);
}

function saveFlashcards(cards) {
  writeFileSync(FLASHCARDS_PATH, JSON.stringify(cards, null, 2), 'utf-8');
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
app.get('/api/flashcards', (req, res) => {
  const cards = loadFlashcards();
  res.json(cards);
});

// Добавить флешкарточку
app.post('/api/flashcards', (req, res) => {
  const { polish, russian, example, baseForm } = req.body;

  if (!polish || !russian) {
    return res.status(400).json({ error: 'Polish and Russian are required' });
  }

  const cards = loadFlashcards();

  // Проверяем, нет ли уже такой карточки
  const exists = cards.some(c => c.polish.toLowerCase() === polish.toLowerCase());
  if (exists) {
    return res.status(409).json({ error: 'Card already exists' });
  }

  const newCard = {
    id: Date.now().toString(),
    polish,
    russian,
    baseForm: baseForm || polish,
    example: example || '',
    createdAt: new Date().toISOString(),
    stats: {
      correct: 0,
      incorrect: 0,
      lastReview: null
    }
  };

  cards.push(newCard);
  saveFlashcards(cards);

  res.status(201).json(newCard);
});

// Удалить флешкарточку
app.delete('/api/flashcards/:id', (req, res) => {
  const { id } = req.params;
  let cards = loadFlashcards();

  const initialLength = cards.length;
  cards = cards.filter(c => c.id !== id);

  if (cards.length === initialLength) {
    return res.status(404).json({ error: 'Card not found' });
  }

  saveFlashcards(cards);
  res.json({ success: true });
});

// Обновить статистику карточки
app.patch('/api/flashcards/:id/stats', (req, res) => {
  const { id } = req.params;
  const { correct } = req.body;

  const cards = loadFlashcards();
  const card = cards.find(c => c.id === id);

  if (!card) {
    return res.status(404).json({ error: 'Card not found' });
  }

  if (correct) {
    card.stats.correct++;
  } else {
    card.stats.incorrect++;
  }
  card.stats.lastReview = new Date().toISOString();

  saveFlashcards(cards);
  res.json(card);
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
