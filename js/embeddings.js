/**
 * embeddings.js — модуль для получения векторных представлений кода.
 *
 * Стратегия (двойная, для устойчивости):
 *  1) Основная: Transformers.js — модель all-MiniLM-L6-v2 работает ПРЯМО В БРАУЗЕРЕ
 *     через WebAssembly. Никаких запросов к api-inference.huggingface.co.
 *  2) Fallback: если модель не удалось загрузить (сеть/блокировки), используется
 *     встроенный лексический поиск (TF-IDF + hashing) — сайт НЕ падает.
 *
 * Обе стратегии возвращают вектор фиксированной размерности (384), поэтому
 * search.js и cache.js не нужно менять.
 */

const EMBED_DIM = 384;

// --- Состояние загрузчика модели ---
let extractor = null;          // экземпляр pipeline Transformers.js
let initPromise = null;        // промис инициализации (чтобы не грузить дважды)
let mode = 'loading';          // 'loading' | 'transformers' | 'fallback'

/**
 * Динамически загружает Transformers.js и создаёт pipeline feature-extraction.
 * Возвращает null, если библиотека недоступна (тогда включается fallback).
 * @returns {Promise<Function|null>}
 */
async function loadTransformers() {
  try {
    const mod = await import('@xenova/transformers');
    const { pipeline, env } = mod;
    // Разрешаем удалённую загрузку модели (квантованная ~22MB) и кеширование в браузере
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    const ex = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true
    });
    return ex;
  } catch (err) {
    console.warn('Transformers.js недоступен, переключаемся на лексический fallback:', err.message);
    return null;
  }
}

/**
 * Ленивая инициализация модели (однократно).
 * @returns {Promise<Function|null>} — pipeline или null (fallback)
 */
async function getExtractor() {
  if (mode === 'transformers') return extractor;
  if (mode === 'fallback') return null;
  if (!initPromise) {
    initPromise = loadTransformers()
      .then(ex => {
        if (ex) {
          extractor = ex;
          mode = 'transformers';
        } else {
          mode = 'fallback';
        }
        return ex;
      })
      .catch(() => {
        mode = 'fallback';
        initPromise = null;
        return null;
      });
  }
  return initPromise;
}

/**
 * Прогрев модели при первом поиске (чтобы показать понятный прогресс).
 * @returns {Promise<void>}
 */
export async function warmup() {
  await getExtractor();
}

/**
 * Текущий режим работы ('transformers' | 'fallback' | 'loading').
 * @returns {string}
 */
export function getMode() {
  return mode;
}

/**
 * Получить эмбеддинг для одного текста.
 * @param {string} text
 * @returns {Promise<number[]>} — вектор 384
 */
export async function getEmbedding(text) {
  if (!text || !text.trim()) {
    throw new Error('Пустой текст для эмбеддинга');
  }

  const truncated = text.length > 2000 ? text.substring(0, 2000) : text;
  const ex = await getExtractor();

  if (ex) {
    try {
      const output = await ex(truncated, { pooling: 'mean', normalize: true });
      return Array.from(output.data);
    } catch (err) {
      console.warn('Ошибка инференса модели, fallback для этого текста:', err.message);
      return hashEmbedding(truncated);
    }
  }

  return hashEmbedding(truncated);
}

/**
 * Пакетная обработка текстов (локально — без сетевых задержек).
 * @param {string[]} texts
 * @param {function} onProgress — (current, total)
 * @returns {Promise<number[][]>}
 */
export async function getEmbeddingsBatch(texts, onProgress = null) {
  const results = [];
  const total = texts.length;

  for (let i = 0; i < total; i++) {
    try {
      results.push(await getEmbedding(texts[i]));
    } catch (err) {
      results.push(new Array(EMBED_DIM).fill(0));
    }
    if (onProgress) onProgress(i + 1, total);
    // Отдаём поток браузеру, чтобы прогресс-бар не «зависал»
    await sleep(0);
  }

  return results;
}

/**
 * Извлечь функции и классы из кода для анализа.
 * @param {string} code
 * @param {string} language
 * @returns {Array<{name:string, code:string, type:string}>}
 */
export function extractCodeBlocks(code, language = 'javascript') {
  const blocks = [];
  if (!code || code.trim().length === 0) return blocks;

  const patterns = {
    javascript: [
      { regex: /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{[\s\S]*?\n\}/g, type: 'function' },
      { regex: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>\s*\{[\s\S]*?\n\}/g, type: 'function' },
      { regex: /(?:export\s+)?class\s+(\w+)[\s\S]*?\n\}/g, type: 'class' }
    ],
    python: [
      { regex: /(?:async\s+)?def\s+(\w+)\s*\([^)]*\):[\s\S]*?(?=\n(?:def|class)|\Z)/g, type: 'function' },
      { regex: /class\s+(\w+)[\s\S]*?(?=\nclass|\Z)/g, type: 'class' }
    ],
    typescript: [
      { regex: /(?:export\s+)?(?:async\s+)?function\s+(\w+)[^)]*\)\s*(?::\s*[^{]+)?\s*\{[\s\S]*?\n\}/g, type: 'function' },
      { regex: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>\s*\{[\s\S]*?\n\}/g, type: 'function' },
      { regex: /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)[^{]*\{[\s\S]*?\n\}/g, type: 'class' }
    ]
  };

  const langPatterns = patterns[language] || patterns.javascript;

  for (const pattern of langPatterns) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match;
    while ((match = regex.exec(code)) !== null) {
      const name = match[1];
      const fullMatch = match[0];
      const truncatedCode = fullMatch.length > 1500 ? fullMatch.substring(0, 1500) : fullMatch;
      blocks.push({ name, code: truncatedCode, type: pattern.type });
    }
  }

  if (blocks.length === 0 && code.length > 0) {
    blocks.push({ name: 'file', code: code.substring(0, 1500), type: 'file' });
  }

  return blocks;
}

// ================== LEXICAL FALLBACK (TF-IDF + hashing) ==================

/**
 * Токенизация кода/текста: camelCase, snake_case, цифры, слова.
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  const cleaned = text.toLowerCase().replace(/[^a-z0-9_]+/g, ' ');
  const raw = cleaned.split(/\s+/).filter(Boolean);
  const out = [];
  for (const w of raw) {
    // разбиваем snake_case и склеиваем цифры
    const parts = w.split(/_/).filter(Boolean);
    for (const p of parts) out.push(p);
  }
  return out;
}

/**
 * Простой хеш строки (FNV-1a) → неотрицательное число.
 * @param {string} str
 * @returns {number}
 */
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Построить хеш-вектор фиксированной размерности из текста (TF + L2-нормализация).
 * Используется как fallback, когда нейросетевая модель недоступна.
 * @param {string} text
 * @returns {number[]}
 */
function hashEmbedding(text) {
  const vec = new Float32Array(EMBED_DIM);
  const tokens = tokenize(text);
  if (tokens.length === 0) return Array.from(vec);

  const tf = Object.create(null);
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1;

  for (const tok in tf) {
    const idx = hashString(tok) % EMBED_DIM;
    vec[idx] += tf[tok];
  }

  let norm = 0;
  for (let i = 0; i < EMBED_DIM; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < EMBED_DIM; i++) vec[i] /= norm;

  return Array.from(vec);
}

/**
 * Утилита: пауза.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
