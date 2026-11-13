/**
 * cache.js — модуль для работы с IndexedDB
 * Кеширует векторы эмбеддингов, чтобы не запрашивать их повторно у Hugging Face API
 */

const DB_NAME = 'codemind';
const STORE_NAME = 'embeddings';
const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 дней в миллисекундах

/**
 * Открыть или создать базу данных IndexedDB
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onerror = () => reject(request.error);

    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
  });
}

/**
 * Сохранить эмбеддинги в кеш
 * @param {string} key — уникальный ключ (например, `${owner}/${repo}/${path}`)
 * @param {Object} data — данные для сохранения
 * @returns {Promise<void>}
 */
export async function saveEmbeddings(key, data) {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    const record = {
      key,
      data,
      timestamp: Date.now()
    };

    store.put(record);

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    console.error('Ошибка сохранения в кеш:', error);
    throw error;
  }
}

/**
 * Получить эмбеддинги из кеша
 * @param {string} key — уникальный ключ
 * @returns {Promise<Object|null>} — данные или null, если нет в кеше или устарели
 */
export async function getEmbeddings(key) {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    const request = store.get(key);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const record = request.result;

        if (!record) {
          resolve(null);
          return;
        }

        // Проверяем, не устарел ли кеш
        const age = Date.now() - record.timestamp;
        if (age > CACHE_DURATION) {
          resolve(null);
          return;
        }

        resolve(record.data);
      };

      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Ошибка получения из кеша:', error);
    throw error;
  }
}

/**
 * Очистить весь кеш
 * @returns {Promise<void>}
 */
export async function clearCache() {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    store.clear();

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    console.error('Ошибка очистки кеша:', error);
    throw error;
  }
}
