// State
let currentText = '';
let currentTranslation = null;
let flashcards = [];
let reviewQueue = [];
let currentReviewIndex = 0;

// Theme initialization
function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = savedTheme || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
}

// Initialize theme immediately
initTheme();

// DOM Elements
const topicInput = document.getElementById('topic-input');
const generateBtn = document.getElementById('generate-btn');
const polishText = document.getElementById('polish-text');
const translationPanel = document.getElementById('translation-panel');
const emptySidebar = document.getElementById('empty-sidebar');
const selectedWordEl = document.getElementById('selected-word');
const translationTextEl = document.getElementById('translation-text');
const baseFormEl = document.getElementById('base-form');
const partOfSpeechEl = document.getElementById('part-of-speech');
const translationNoteEl = document.getElementById('translation-note');
const addCardBtn = document.getElementById('add-card-btn');
const selectionPopup = document.getElementById('selection-popup');
const translateSelectionBtn = document.getElementById('translate-selection-btn');
const loadingOverlay = document.getElementById('loading-overlay');
const toast = document.getElementById('toast');
const cardsCount = document.getElementById('cards-count');
const cardsContainer = document.getElementById('cards-container');

// Tab Elements
const tabBtns = document.querySelectorAll('.tab-btn');
const readingTab = document.getElementById('reading-tab');
const flashcardsTab = document.getElementById('flashcards-tab');

// Review Elements
const startReviewBtn = document.getElementById('start-review-btn');
const showListBtn = document.getElementById('show-list-btn');
const cardsList = document.getElementById('cards-list');
const reviewMode = document.getElementById('review-mode');
const reviewWord = document.getElementById('review-word');
const reviewExample = document.getElementById('review-example');
const reviewTranslation = document.getElementById('review-translation');
const cardFront = document.getElementById('card-front');
const cardBack = document.getElementById('card-back');
const showAnswerBtn = document.getElementById('show-answer-btn');
const reviewControls = document.getElementById('review-controls');
const btnIncorrect = document.getElementById('btn-incorrect');
const btnCorrect = document.getElementById('btn-correct');
const reviewProgress = document.getElementById('review-progress');

// Security: HTML escape function to prevent XSS
function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Utils
function showLoading() {
  loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
  loadingOverlay.classList.add('hidden');
}

function showToast(message, type = 'info') {
  toast.textContent = message;
  toast.className = 'toast';
  if (type !== 'info') {
    toast.classList.add(type);
  }
  toast.classList.remove('hidden');

  setTimeout(() => {
    toast.classList.add('hidden');
  }, 3000);
}

// Text Generation
async function generateText() {
  const topic = topicInput.value.trim();
  if (!topic) {
    showToast('Введите тему', 'error');
    return;
  }

  showLoading();
  generateBtn.disabled = true;

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic })
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to generate');
    }

    const data = await res.json();
    currentText = data.text;
    renderText(data.text);
    hideTranslationPanel();
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Ошибка генерации текста', 'error');
  } finally {
    hideLoading();
    generateBtn.disabled = false;
  }
}

// Safe text rendering without innerHTML XSS vulnerability
function renderText(text) {
  // Clear existing content
  polishText.innerHTML = '';

  // Split text into words, preserving whitespace
  const words = text.split(/(\s+)/);

  words.forEach(part => {
    // Whitespace - add as text node
    if (/^\s+$/.test(part)) {
      polishText.appendChild(document.createTextNode(part));
      return;
    }

    // Extract word and punctuation
    const match = part.match(/^([^\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ]*)([\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ]+)([^\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ]*)$/i);

    if (match) {
      const [, before, word, after] = match;

      // Add punctuation before word
      if (before) {
        polishText.appendChild(document.createTextNode(before));
      }

      // Create clickable word span (safe - using textContent)
      const span = document.createElement('span');
      span.className = 'word';
      span.dataset.word = word;
      span.textContent = word;
      span.addEventListener('click', handleWordClick);
      polishText.appendChild(span);

      // Add punctuation after word
      if (after) {
        polishText.appendChild(document.createTextNode(after));
      }
    } else {
      // Non-matching text - add as text node (safe)
      polishText.appendChild(document.createTextNode(part));
    }
  });
}

async function handleWordClick(e) {
  const word = e.target.dataset.word;

  // Убираем выделение с предыдущего слова
  document.querySelectorAll('.word.selected').forEach(el => {
    el.classList.remove('selected');
  });

  // Выделяем текущее слово
  e.target.classList.add('selected');

  await translateWord(word);
}

async function translateWord(word) {
  showLoading();

  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word, context: currentText })
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to translate');
    }

    const data = await res.json();
    showTranslation(word, data);
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Ошибка перевода', 'error');
  } finally {
    hideLoading();
  }
}

function showTranslation(word, data) {
  currentTranslation = { word, ...data };

  // Safe: using textContent instead of innerHTML
  selectedWordEl.textContent = word;
  translationTextEl.textContent = data.translation;
  baseFormEl.textContent = data.baseForm && data.baseForm !== word
    ? `Базовая форма: ${data.baseForm}`
    : '';
  partOfSpeechEl.textContent = data.partOfSpeech || '';
  translationNoteEl.textContent = data.note || '';

  emptySidebar.classList.add('hidden');
  translationPanel.classList.remove('hidden');

  // Проверяем, есть ли уже такая карточка
  const exists = flashcards.some(c =>
    c.polish.toLowerCase() === word.toLowerCase() ||
    (data.baseForm && c.polish.toLowerCase() === data.baseForm.toLowerCase())
  );

  addCardBtn.disabled = exists;
  addCardBtn.textContent = exists ? 'Уже в карточках' : '+ Добавить в карточки';
}

function hideTranslationPanel() {
  translationPanel.classList.add('hidden');
  emptySidebar.classList.remove('hidden');
  currentTranslation = null;
}

// Selection handling
document.addEventListener('mouseup', handleSelection);
document.addEventListener('touchend', handleSelection);

function handleSelection(e) {
  // Игнорируем, если клик был на popup
  if (selectionPopup.contains(e.target)) return;

  const selection = window.getSelection();
  const selectedText = selection.toString().trim();

  if (selectedText && selectedText.includes(' ') && polishText.contains(selection.anchorNode)) {
    // Показываем popup для перевода предложения
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    selectionPopup.style.left = `${rect.left + rect.width / 2 - 50}px`;
    selectionPopup.style.top = `${rect.bottom + 8}px`;
    selectionPopup.classList.remove('hidden');
  } else {
    selectionPopup.classList.add('hidden');
  }
}

translateSelectionBtn.addEventListener('click', async () => {
  const selection = window.getSelection();
  const selectedText = selection.toString().trim();

  if (selectedText) {
    selectionPopup.classList.add('hidden');
    await translateWord(selectedText);
  }
});

// Hide selection popup on scroll or click outside
document.addEventListener('scroll', () => {
  selectionPopup.classList.add('hidden');
});

document.addEventListener('click', (e) => {
  if (!selectionPopup.contains(e.target)) {
    setTimeout(() => {
      selectionPopup.classList.add('hidden');
    }, 100);
  }
});

// Flashcards
async function loadFlashcards() {
  try {
    const res = await fetch('/api/flashcards');
    flashcards = await res.json();
    updateCardsCount();
    renderCardsList();
  } catch (err) {
    console.error(err);
  }
}

function updateCardsCount() {
  cardsCount.textContent = `(${flashcards.length})`;
}

async function addFlashcard() {
  if (!currentTranslation) return;

  const card = {
    polish: currentTranslation.baseForm || currentTranslation.word,
    russian: currentTranslation.translation,
    baseForm: currentTranslation.baseForm,
    example: currentText ? `...${currentTranslation.word}...` : ''
  };

  try {
    const res = await fetch('/api/flashcards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(card)
    });

    if (res.status === 409) {
      showToast('Карточка уже существует', 'error');
      return;
    }

    if (!res.ok) throw new Error('Failed to add card');

    const newCard = await res.json();
    flashcards.push(newCard);
    updateCardsCount();
    renderCardsList();

    addCardBtn.disabled = true;
    addCardBtn.textContent = 'Уже в карточках';

    showToast('Карточка добавлена', 'success');
  } catch (err) {
    console.error(err);
    showToast('Ошибка добавления карточки', 'error');
  }
}

async function deleteFlashcard(id) {
  try {
    const res = await fetch(`/api/flashcards/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });

    if (!res.ok) throw new Error('Failed to delete');

    flashcards = flashcards.filter(c => c.id !== id);
    updateCardsCount();
    renderCardsList();

    showToast('Карточка удалена');
  } catch (err) {
    console.error(err);
    showToast('Ошибка удаления', 'error');
  }
}

// Safe cards list rendering without XSS
function renderCardsList() {
  // Clear container
  cardsContainer.innerHTML = '';

  if (flashcards.length === 0) {
    const emptyMsg = document.createElement('p');
    emptyMsg.className = 'empty-cards';
    emptyMsg.textContent = 'Пока нет карточек. Добавь слова из текстов!';
    cardsContainer.appendChild(emptyMsg);
    return;
  }

  flashcards.forEach(card => {
    const cardItem = document.createElement('div');
    cardItem.className = 'card-item';
    cardItem.dataset.id = card.id;

    const content = document.createElement('div');
    content.className = 'card-item-content';

    const polishDiv = document.createElement('div');
    polishDiv.className = 'card-item-polish';
    polishDiv.textContent = card.polish; // Safe: textContent

    const russianDiv = document.createElement('div');
    russianDiv.className = 'card-item-russian';
    russianDiv.textContent = card.russian; // Safe: textContent

    content.appendChild(polishDiv);
    content.appendChild(russianDiv);

    if (card.example) {
      const exampleDiv = document.createElement('div');
      exampleDiv.className = 'card-item-example';
      exampleDiv.textContent = card.example; // Safe: textContent
      content.appendChild(exampleDiv);
    }

    const statsDiv = document.createElement('div');
    statsDiv.className = 'card-item-stats';
    statsDiv.textContent = `Верно: ${card.stats?.correct || 0} | Неверно: ${card.stats?.incorrect || 0}`;
    content.appendChild(statsDiv);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'card-delete-btn';
    deleteBtn.textContent = 'Удалить';
    deleteBtn.addEventListener('click', () => deleteFlashcard(card.id));

    cardItem.appendChild(content);
    cardItem.appendChild(deleteBtn);
    cardsContainer.appendChild(cardItem);
  });
}

// Review Mode
function startReview() {
  if (flashcards.length === 0) {
    showToast('Нет карточек для повторения', 'error');
    return;
  }

  // Перемешиваем карточки
  reviewQueue = [...flashcards].sort(() => Math.random() - 0.5);
  currentReviewIndex = 0;

  cardsList.classList.add('hidden');
  reviewMode.classList.remove('hidden');
  showListBtn.classList.remove('active');
  startReviewBtn.classList.add('active');

  showCurrentCard();
}

function showCardsList() {
  reviewMode.classList.add('hidden');
  cardsList.classList.remove('hidden');
  startReviewBtn.classList.remove('active');
  showListBtn.classList.add('active');
}

function showCurrentCard() {
  if (currentReviewIndex >= reviewQueue.length) {
    showToast('Повторение завершено!', 'success');
    showCardsList();
    return;
  }

  const card = reviewQueue[currentReviewIndex];

  // Safe: using textContent
  reviewWord.textContent = card.polish;
  reviewExample.textContent = card.example || '';
  reviewTranslation.textContent = card.russian;

  cardBack.classList.add('hidden');
  showAnswerBtn.classList.remove('hidden');
  reviewControls.classList.add('hidden');

  reviewProgress.textContent = `${currentReviewIndex + 1} / ${reviewQueue.length}`;
}

function showAnswer() {
  cardBack.classList.remove('hidden');
  showAnswerBtn.classList.add('hidden');
  reviewControls.classList.remove('hidden');
}

async function markCard(correct) {
  const card = reviewQueue[currentReviewIndex];

  try {
    await fetch(`/api/flashcards/${encodeURIComponent(card.id)}/stats`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correct })
    });

    // Обновляем локальную статистику
    const originalCard = flashcards.find(c => c.id === card.id);
    if (originalCard) {
      if (!originalCard.stats) originalCard.stats = { correct: 0, incorrect: 0 };
      if (correct) {
        originalCard.stats.correct++;
      } else {
        originalCard.stats.incorrect++;
      }
    }
  } catch (err) {
    console.error(err);
  }

  currentReviewIndex++;
  showCurrentCard();
}

// Event Listeners
generateBtn.addEventListener('click', generateText);

topicInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    generateText();
  }
});

addCardBtn.addEventListener('click', addFlashcard);

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;

    tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    if (tab === 'reading') {
      readingTab.classList.add('active');
      flashcardsTab.classList.remove('active');
    } else {
      readingTab.classList.remove('active');
      flashcardsTab.classList.add('active');
      renderCardsList();
    }
  });
});

startReviewBtn.addEventListener('click', startReview);
showListBtn.addEventListener('click', showCardsList);
showAnswerBtn.addEventListener('click', showAnswer);
btnIncorrect.addEventListener('click', () => markCard(false));
btnCorrect.addEventListener('click', () => markCard(true));

// Theme Toggle
const themeToggle = document.getElementById('theme-toggle');

themeToggle.addEventListener('click', () => {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
});

// Initialize Lucide icons
if (typeof lucide !== 'undefined') {
  lucide.createIcons();
}

// Init
loadFlashcards();
