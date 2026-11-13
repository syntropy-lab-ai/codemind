/**
 * embeddings.js — модуль для работы с Hugging Face Inference API
 */

const HF_API_URL = 'https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2';
const RATE_LIMIT_DELAY = 2000;
const MAX_RETRIES = 2;

/**
 * Получить эмбеддинг для одного текста
 */
export async function getEmbedding(text, retryCount = 0) {
  if (!text || text.trim().length === 0) {
    throw new Error('Пустой текст для эмбеддинга');
  }

  const truncatedText = text.length > 2000 ? text.substring(0, 2000) : text;

  const response = await fetch(HF_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      inputs: truncatedText,
      options: { wait_for_model: true }
    })
  });

  if (!response.ok) {
    if (response.status === 503 && retryCount < MAX_RETRIES) {
      console.log('Модель загружается, повтор через 10 сек...');
      await sleep(10000);
      return getEmbedding(text, retryCount + 1);
    }
    if (response.status === 429) throw new Error('Лимит Hugging Face API. Подождите минуту.');
    if (response.status === 400) throw new Error('Некорректный запрос к HF API.');
    throw new Error(`Ошибка HF API: ${response.status}`);
  }

  const data = await response.json();

  if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
    return data[0];
  }

  throw new Error('Неожиданный формат ответа от HF API');
}

/**
 * Получить эмбеддинги для массива текстов с очередью
 */
export async function getEmbeddingsBatch(texts, onProgress = null) {
  const results = [];
  const total = texts.length;

  for (let i = 0; i < total; i++) {
    try {
      const embedding = await getEmbedding(texts[i]);
      results.push(embedding);
      if (onProgress) onProgress(i + 1, total);
      if (i < total - 1) await sleep(RATE_LIMIT_DELAY);
    } catch (error) {
      console.error(`Ошибка текста ${i + 1}:`, error.message);
      results.push(new Array(384).fill(0));
      if (onProgress) onProgress(i + 1, total);
    }
  }

  return results;
}

/**
 * Извлечь функции и классы из кода
 */
export function extractCodeBlocks(code, language = 'javascript') {
  const blocks = [];
  if (!code || code.trim().length === 0) return blocks;

  // Простые универсальные паттерны (без спецсимволов типа \Z)
  const patterns = [
    { regex: /function\s+(\w+)\s*\([^)]*\)\s*\{[^}]*\}/g, type: 'function' },
    { regex: /async\s+function\s+(\w+)\s*\([^)]*\)\s*\{[^}]*\}/g, type: 'function' },
    { regex: /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>\s*\{[^}]*\}/g, type: 'function' },
    { regex: /def\s+(\w+)\s*\([^)]*\)\s*:/g, type: 'function' },
    { regex: /class\s+(\w+)/g, type: 'class' }
  ];

  for (const pattern of patterns) {
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(code)) !== null) {
      const name = match[1];
      const fullMatch = match[0];
      const truncatedCode = fullMatch.length > 1500 ? fullMatch.substring(0, 1500) : fullMatch;
      blocks.push({ name, code: truncatedCode, type: pattern.type });
    }
  }

  // Убираем дубликаты
  const seen = new Set();
  const unique = blocks.filter(b => {
    if (seen.has(b.name)) return false;
    seen.add(b.name);
    return true;
  });

  // Если ничего не нашли — берём весь файл как один блок
  if (unique.length === 0 && code.length > 0) {
    unique.push({
      name: 'file',
      code: code.substring(0, 1500),
      type: 'file'
    });
  }

  return unique;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
