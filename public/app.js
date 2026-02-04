// State
let currentText = '';
let currentTranslation = null;
let flashcards = [];
let reviewQueue = [];
let currentReviewIndex = 0;

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

    if (!res.ok) throw new Error('Failed to generate');

    const data = await res.json();
    currentText = data.text;
    renderText(data.text);
    hideTranslationPanel();
  } catch (err) {
    console.error(err);
    showToast('Ошибка генерации текста', 'error');
  } finally {
    hideLoading();
    generateBtn.disabled = false;
  }
}

function renderText(text) {
  // Разбиваем текст на слова, сохраняя пунктуацию
  const words = text.split(/(\s+)/);

  const html = words.map(part => {
    // Пропускаем пробелы
    if (/^\s+$/.test(part)) {
      return part;
    }

    // Извлекаем слово и пунктуацию
    const match = part.match(/^([^\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ]*)([\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ]+)([^\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ]*)$/i);

    if (match) {
      const [, before, word, after] = match;
      return `${before}<span class="word" data-word="${word}">${word}</span>${after}`;
    }

    return part;
  }).join('');

  polishText.innerHTML = html;

  // Добавляем обработчики кликов на слова
  document.querySelectorAll('.word').forEach(wordEl => {
    wordEl.addEventListener('click', handleWordClick);
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

    if (!res.ok) throw new Error('Failed to translate');

    const data = await res.json();
    showTranslation(word, data);
  } catch (err) {
    console.error(err);
    showToast('Ошибка перевода', 'error');
  } finally {
    hideLoading();
  }
}

function showTranslation(word, data) {
  currentTranslation = { word, ...data };

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
    const res = await fetch(`/api/flashcards/${id}`, {
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

function renderCardsList() {
  if (flashcards.length === 0) {
    cardsContainer.innerHTML = '<p class="empty-cards">Пока нет карточек. Добавь слова из текстов!</p>';
    return;
  }

  cardsContainer.innerHTML = flashcards.map(card => `
    <div class="card-item" data-id="${card.id}">
      <div class="card-item-content">
        <div class="card-item-polish">${card.polish}</div>
        <div class="card-item-russian">${card.russian}</div>
        ${card.example ? `<div class="card-item-example">${card.example}</div>` : ''}
        <div class="card-item-stats">
          Верно: ${card.stats?.correct || 0} | Неверно: ${card.stats?.incorrect || 0}
        </div>
      </div>
      <button class="card-delete-btn" onclick="deleteFlashcard('${card.id}')">Удалить</button>
    </div>
  `).join('');
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
    await fetch(`/api/flashcards/${card.id}/stats`, {
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

// Make deleteFlashcard available globally for onclick
window.deleteFlashcard = deleteFlashcard;

// Init
loadFlashcards();
