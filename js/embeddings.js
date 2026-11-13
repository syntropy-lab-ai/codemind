/**
 * embeddings.js — модуль для работы с Hugging Face Inference API
 * Получает векторные представления (эмбеддинги) текста для семантического поиска
 */

const HF_API_URL = 'https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2';
const RATE_LIMIT_DELAY = 2000; // 2 секунды между запросами (лимит ~30 req/min)
const MAX_RETRIES = 2;

/**
 * Получить эмбеддинг для одного текста
 * @param {string} text — текст для анализа
 * @param {number} retryCount — текущая попытка (для рекурсии при 503)
 * @returns {Promise<number[]>} — вектор эмбеддинга (384 числа)
 */
export async function getEmbedding(text, retryCount = 0) {
  if (!text || text.trim().length === 0) {
    throw new Error('Пустой текст для эмбеддинга');
  }

  // Ограничиваем длину текста (модель принимает до 512 токенов, ~300-400 слов)
  const truncatedText = text.length > 2000 ? text.substring(0, 2000) : text;

  const response = await fetch(HF_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      inputs: truncatedText,
      options: {
        wait_for_model: true
      }
    })
  });

  if (!response.ok) {
    if (response.status === 503 && retryCount < MAX_RETRIES) {
      // Модель загружается, ждём и повторяем
      console.log('Модель загружается, повторная попытка через 10 сек...');
      await sleep(10000);
      return getEmbedding(text, retryCount + 1);
    }
    if (response.status === 429) {
      throw new Error('Превышен лимит запросов Hugging Face API. Подождите минуту и попробуйте снова.');
    }
    if (response.status === 400) {
      throw new Error('Некорректный запрос к Hugging Face API.');
    }
    throw new Error(`Ошибка Hugging Face API: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  // API возвращает массив векторов (для одного текста — массив с одним элементом)
  if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
    return data[0];
  }

  throw new Error('Неожиданный формат ответа от Hugging Face API');
}

/**
 * Получить эмбеддинги для массива текстов с очередью и задержками
 * @param {string[]} texts — массив текстов
 * @param {function} onProgress — коллбэк для отображения прогресса (current, total)
 * @returns {Promise<number[][]>} — массив векторов
 */
export async function getEmbeddingsBatch(texts, onProgress = null) {
  const results = [];
  const total = texts.length;

  for (let i = 0; i < total; i++) {
    try {
      const embedding = await getEmbedding(texts[i]);
      results.push(embedding);

      if (onProgress) {
        onProgress(i + 1, total);
      }

      // Задержка между запросами (кроме последнего)
      if (i < total - 1) {
        await sleep(RATE_LIMIT_DELAY);
      }
    } catch (error) {
      console.error(`Ошибка при обработке текста ${i + 1}:`, error);
      // Возвращаем нулевой вектор той же размерности (384)
      results.push(new Array(384).fill(0));

      if (onProgress) {
        onProgress(i + 1, total);
      }
    }
  }

  return results;
}

/**
 * Извлечь функции и классы из кода для анализа
 * @param {string} code — исходный код
 * @param {string} language — язык программирования
 * @returns {Array} — массив объектов {name, code, type}
 */
export function extractCodeBlocks(code, language = 'javascript') {
  const blocks = [];

  if (!code || code.trim().length === 0) {
    return blocks;
  }

  // Разные паттерны для разных языков
  const patterns = {
    javascript: [
      { regex: /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{[^}]*\}/g, type: 'function' },
      { regex: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>\s*\{[^}]*\}/g, type: 'function' },
      { regex: /class\s+(\w+)\s*\{[^}]*\}/g, type: 'class' }
    ],
    python: [
      { regex: /(?:async\s+)?def\s+(\w+)\s*\([^)]*\):[\s\S]*?(?=\n(?:def|class)|\Z)/g, type: 'function' },
      { regex: /class\s+(\w+)[\s\S]*?(?=\n(?:def|class)|\Z)/g, type: 'class' }
    ],
    typescript: [
      { regex: /(?:export\s+)?(?:async\s+)?function\s+(\w+)[^)]*\)\s*(?::\s*[^{]+)?\s*\{[^}]*\}/g, type: 'function' },
      { regex: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>\s*\{[^}]*\}/g, type: 'function' },
      { regex: /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)[^{]*\{[^}]*\
