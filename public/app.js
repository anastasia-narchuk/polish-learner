// State
let currentText = '';
let currentTranslation = null;
let flashcards = [];
let reviewQueue = [];
let currentReviewIndex = 0;

// Import state
let importMode = 'comma';
let proposedCards = [];

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

// ========================================
// Import Feature
// ========================================

const importBtn = document.getElementById('import-btn');
const importModal = document.getElementById('import-modal');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalTabs = document.querySelectorAll('.modal-tab');
const importTextarea = document.getElementById('import-textarea');
const importTextareaContainer = document.getElementById('import-textarea-container');
const manualEntryContainer = document.getElementById('manual-entry-container');
const manualPolishInput = document.getElementById('manual-polish');
const manualRussianInput = document.getElementById('manual-russian');
const importHint = document.getElementById('import-hint');
const importProcessBtn = document.getElementById('import-process-btn');
const importProcessBtnText = document.getElementById('import-process-btn-text');
const importInputPhase = document.getElementById('import-input-phase');
const importPreviewPhase = document.getElementById('import-preview-phase');
const importPreviewList = document.getElementById('import-preview-list');
const importWarnings = document.getElementById('import-warnings');
const warningsList = document.getElementById('warnings-list');
const importUnrecognized = document.getElementById('import-unrecognized');
const unrecognizedList = document.getElementById('unrecognized-list');
const importBackBtn = document.getElementById('import-back-btn');
const importSaveBtn = document.getElementById('import-save-btn');
const selectedCountEl = document.getElementById('selected-count');
const unrecognizedBadge = document.getElementById('unrecognized-badge');
const unrecognizedReviewSection = document.getElementById('import-unrecognized-review');
const unrecognizedReviewList = document.getElementById('unrecognized-review-list');

// Open import modal
importBtn.addEventListener('click', () => {
  importModal.classList.remove('hidden');
  resetImportState();
  loadUnrecognizedWords();
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
});

// Close modal
function closeImportModal() {
  importModal.classList.add('hidden');
  resetImportState();
}

modalCloseBtn.addEventListener('click', closeImportModal);

importModal.addEventListener('click', (e) => {
  if (e.target === importModal) {
    closeImportModal();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !importModal.classList.contains('hidden')) {
    closeImportModal();
  }
});

// Reset import state
function resetImportState() {
  importMode = 'comma';
  proposedCards = [];
  importTextarea.value = '';
  manualPolishInput.value = '';
  manualRussianInput.value = '';
  importInputPhase.classList.remove('hidden');
  importPreviewPhase.classList.add('hidden');
  updateImportUI();

  // Reset tabs
  modalTabs.forEach(t => t.classList.remove('active'));
  modalTabs[0].classList.add('active');
}

// Mode tab switching
modalTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    modalTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    importMode = tab.dataset.importMode;
    updateImportUI();
  });
});

function updateImportUI() {
  if (importMode === 'manual') {
    importTextareaContainer.classList.add('hidden');
    manualEntryContainer.classList.remove('hidden');
    importProcessBtnText.textContent = 'Добавить карточку';
  } else {
    importTextareaContainer.classList.remove('hidden');
    manualEntryContainer.classList.add('hidden');
    importProcessBtnText.textContent = 'Обработать';

    const placeholders = {
      comma: 'kot, pies, dom, szkoła',
      lines: 'kot\npies\ndom\nszkoła',
      notes: 'Вставьте заметки с урока...',
    };
    const hints = {
      comma: 'Введите польские слова через запятую',
      lines: 'Одно слово на строку',
      notes: 'Вставьте необработанные заметки — AI извлечёт польские слова',
    };
    importTextarea.placeholder = placeholders[importMode];
    importHint.textContent = hints[importMode];
  }

  // Re-init icons
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

// Process button click
importProcessBtn.addEventListener('click', async () => {
  if (importMode === 'manual') {
    await handleManualAdd();
    return;
  }

  const text = importTextarea.value.trim();
  if (!text) {
    showToast('Введите текст', 'error');
    return;
  }

  showLoading();
  importProcessBtn.disabled = true;

  try {
    if (importMode === 'notes') {
      // Mode 3: send raw text
      const res = await fetch('/api/import/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Import failed');
      }
      const data = await res.json();
      proposedCards = data.proposed;
      showImportPreview(data.proposed, data.duplicates, data.warnings, data.unrecognized);
    } else {
      // Modes 1 & 2: parse words locally, send array
      let words;
      if (importMode === 'comma') {
        words = text.split(',').map(w => w.trim()).filter(Boolean);
      } else {
        words = text.split('\n').map(w => w.trim()).filter(Boolean);
      }

      if (words.length === 0) {
        showToast('Не найдено слов', 'error');
        return;
      }
      if (words.length > 50) {
        showToast('Максимум 50 слов за раз', 'error');
        return;
      }

      const res = await fetch('/api/import/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words, mode: importMode })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Import failed');
      }
      const data = await res.json();
      proposedCards = data.proposed;
      showImportPreview(data.proposed, data.duplicates, [], []);
    }
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Ошибка импорта', 'error');
  } finally {
    hideLoading();
    importProcessBtn.disabled = false;
  }
});

// Show preview phase
function showImportPreview(proposed, duplicates, warnings, unrecognized) {
  importInputPhase.classList.add('hidden');
  importPreviewPhase.classList.remove('hidden');

  renderPreviewCards(proposed, duplicates);

  // Warnings
  if (warnings && warnings.length > 0) {
    importWarnings.classList.remove('hidden');
    warningsList.innerHTML = '';
    warnings.forEach(w => {
      const li = document.createElement('li');
      li.className = 'import-warning-item';
      li.textContent = w;
      warningsList.appendChild(li);
    });
  } else {
    importWarnings.classList.add('hidden');
  }

  // Unrecognized
  if (unrecognized && unrecognized.length > 0) {
    importUnrecognized.classList.remove('hidden');
    unrecognizedList.innerHTML = '';
    unrecognized.forEach(u => {
      const li = document.createElement('li');
      li.className = 'import-unrecognized-item';
      li.textContent = `${u.text} — ${u.aiNote}`;
      unrecognizedList.appendChild(li);
    });
  } else {
    importUnrecognized.classList.add('hidden');
  }
}

// Render preview cards
function renderPreviewCards(proposed, duplicates) {
  importPreviewList.innerHTML = '';

  if (proposed.length === 0 && duplicates.length === 0) {
    const emptyMsg = document.createElement('p');
    emptyMsg.className = 'empty-cards';
    emptyMsg.textContent = 'Нет новых слов для добавления';
    importPreviewList.appendChild(emptyMsg);
    updateSelectedCount();
    return;
  }

  proposed.forEach((card, index) => {
    const row = document.createElement('div');
    row.className = 'preview-card-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.dataset.index = index;
    checkbox.addEventListener('change', updateSelectedCount);

    const polishSpan = document.createElement('span');
    polishSpan.className = 'preview-card-polish';
    polishSpan.textContent = card.polish;

    const arrow = document.createElement('span');
    arrow.className = 'preview-card-arrow';
    arrow.textContent = ' → ';

    const russianSpan = document.createElement('span');
    russianSpan.className = 'preview-card-russian';
    russianSpan.textContent = card.russian;

    row.appendChild(checkbox);
    row.appendChild(polishSpan);
    row.appendChild(arrow);
    row.appendChild(russianSpan);

    // Show spelling correction indicator
    if (card.originalText && card.originalText !== card.polish) {
      const corrected = document.createElement('span');
      corrected.className = 'preview-card-correction';
      corrected.textContent = `было: ${card.originalText}`;
      row.appendChild(corrected);
    }

    importPreviewList.appendChild(row);
  });

  // Show duplicates as disabled rows
  duplicates.forEach(word => {
    const row = document.createElement('div');
    row.className = 'preview-card-item duplicate';

    const label = document.createElement('span');
    label.className = 'preview-card-polish';
    label.textContent = word;

    const dupLabel = document.createElement('span');
    dupLabel.className = 'preview-card-russian';
    dupLabel.textContent = '— уже в карточках';
    dupLabel.style.color = 'var(--accent-warning)';

    row.appendChild(label);
    row.appendChild(dupLabel);
    importPreviewList.appendChild(row);
  });

  updateSelectedCount();
}

// Update selected count display
function updateSelectedCount() {
  const checked = importPreviewList.querySelectorAll('input[type="checkbox"]:checked');
  selectedCountEl.textContent = checked.length;
  importSaveBtn.disabled = checked.length === 0;
}

// Back button
importBackBtn.addEventListener('click', () => {
  importPreviewPhase.classList.add('hidden');
  importInputPhase.classList.remove('hidden');
  proposedCards = [];
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
});

// Save selected cards
importSaveBtn.addEventListener('click', async () => {
  const checkboxes = importPreviewList.querySelectorAll('input[type="checkbox"]:checked');
  const selectedIndices = Array.from(checkboxes).map(cb => parseInt(cb.dataset.index));
  const selectedCards = selectedIndices.map(i => proposedCards[i]);

  if (selectedCards.length === 0) {
    showToast('Не выбрано ни одной карточки', 'error');
    return;
  }

  showLoading();
  importSaveBtn.disabled = true;

  try {
    const res = await fetch('/api/flashcards/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cards: selectedCards })
    });

    if (!res.ok) throw new Error('Failed to save cards');
    const data = await res.json();

    // Update local state
    flashcards.push(...data.added);
    updateCardsCount();
    renderCardsList();

    const msg = `Добавлено ${data.count.added} карточек` +
      (data.count.skipped > 0 ? `, пропущено ${data.count.skipped}` : '');
    showToast(msg, 'success');

    closeImportModal();
  } catch (err) {
    console.error(err);
    showToast('Ошибка сохранения', 'error');
  } finally {
    hideLoading();
    importSaveBtn.disabled = false;
  }
});

// Manual card creation (Mode 4)
async function handleManualAdd() {
  const polish = manualPolishInput.value.trim();
  const russian = manualRussianInput.value.trim();

  if (!polish || !russian) {
    showToast('Заполните оба поля', 'error');
    return;
  }

  showLoading();
  importProcessBtn.disabled = true;

  try {
    const res = await fetch('/api/flashcards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ polish, russian, baseForm: polish, example: '' })
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

    // Clear inputs for next entry
    manualPolishInput.value = '';
    manualRussianInput.value = '';
    manualPolishInput.focus();

    showToast('Карточка добавлена', 'success');
  } catch (err) {
    console.error(err);
    showToast('Ошибка добавления', 'error');
  } finally {
    hideLoading();
    importProcessBtn.disabled = false;
  }
}

// Unrecognized words management
async function loadUnrecognizedWords() {
  try {
    const res = await fetch('/api/unrecognized');
    const words = await res.json();
    const pending = words.filter(w => w.status === 'pending');

    // Update badge
    if (pending.length > 0) {
      unrecognizedBadge.textContent = pending.length;
      unrecognizedBadge.classList.remove('hidden');
    } else {
      unrecognizedBadge.classList.add('hidden');
    }

    // Render review list inside modal
    renderUnrecognizedReview(pending);
  } catch (err) {
    console.error('Error loading unrecognized words:', err);
  }
}

function renderUnrecognizedReview(words) {
  if (words.length === 0) {
    unrecognizedReviewSection.classList.add('hidden');
    return;
  }

  unrecognizedReviewSection.classList.remove('hidden');
  unrecognizedReviewList.innerHTML = '';

  words.forEach(word => {
    const item = document.createElement('div');
    item.className = 'unrecognized-review-item';

    const textDiv = document.createElement('div');
    textDiv.className = 'unrecognized-review-text';

    const wordSpan = document.createElement('div');
    wordSpan.className = 'unrecognized-review-word';
    wordSpan.textContent = word.text;

    const noteSpan = document.createElement('div');
    noteSpan.className = 'unrecognized-review-note';
    noteSpan.textContent = word.aiNote || '';

    textDiv.appendChild(wordSpan);
    textDiv.appendChild(noteSpan);

    const actions = document.createElement('div');
    actions.className = 'unrecognized-review-actions';

    const createBtn = document.createElement('button');
    createBtn.className = 'unrecognized-action-btn create';
    createBtn.textContent = 'Создать';
    createBtn.addEventListener('click', () => {
      // Switch to manual mode pre-filled
      modalTabs.forEach(t => t.classList.remove('active'));
      modalTabs[3].classList.add('active');
      importMode = 'manual';
      updateImportUI();
      manualPolishInput.value = word.text;
      manualPolishInput.focus();
      importInputPhase.classList.remove('hidden');
      importPreviewPhase.classList.add('hidden');

      // Mark as resolved
      markUnrecognizedWord(word.id, 'resolved');
    });

    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'unrecognized-action-btn dismiss';
    dismissBtn.textContent = 'Убрать';
    dismissBtn.addEventListener('click', () => {
      markUnrecognizedWord(word.id, 'dismissed');
      item.remove();
      // Update badge count
      const remaining = unrecognizedReviewList.children.length;
      if (remaining === 0) {
        unrecognizedReviewSection.classList.add('hidden');
        unrecognizedBadge.classList.add('hidden');
      } else {
        unrecognizedBadge.textContent = remaining;
      }
    });

    actions.appendChild(createBtn);
    actions.appendChild(dismissBtn);

    item.appendChild(textDiv);
    item.appendChild(actions);
    unrecognizedReviewList.appendChild(item);
  });
}

async function markUnrecognizedWord(id, status) {
  try {
    await fetch(`/api/unrecognized/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
  } catch (err) {
    console.error('Error updating unrecognized word:', err);
  }
}

// Load unrecognized badge on init
async function loadUnrecognizedBadge() {
  try {
    const res = await fetch('/api/unrecognized');
    const words = await res.json();
    const pending = words.filter(w => w.status === 'pending');
    if (pending.length > 0) {
      unrecognizedBadge.textContent = pending.length;
      unrecognizedBadge.classList.remove('hidden');
    } else {
      unrecognizedBadge.classList.add('hidden');
    }
  } catch (err) {
    // Silent fail for badge
  }
}

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
loadUnrecognizedBadge();
