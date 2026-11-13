/**
 * app.js — главный модуль приложения CodeMind
 * Инициализирует приложение и оркестрирует все операции поиска
 */

import { fetchRepos, fetchCodeFiles, fetchFileContent } from './github.js';
import { getEmbedding, getEmbeddingsBatch, extractCodeBlocks } from './embeddings.js';
import { saveEmbeddings, getEmbeddings, clearCache } from './cache.js';
import { cosineSimilarity, search } from './search.js';
import { showProgress, hideProgress, displayResults, showError } from './ui.js';

const STORAGE_KEY = 'github_token';

/**
 * Инициализация приложения при загрузке страницы
 */
export function init() {
  // Загружаем сохранённый токен из localStorage
  const savedToken = localStorage.getItem(STORAGE_KEY);
  if (savedToken) {
    const tokenInput = document.getElementById('token');
    if (tokenInput) {
      tokenInput.value = savedToken;
    }
  }

  // Привязываем обработчик кнопки поиска
  const searchBtn = document.getElementById('search-btn');
  if (searchBtn) {
    searchBtn.addEventListener('click', handleSearch);
  }

  // Обработка Enter в полях ввода
  const inputs = document.querySelectorAll('input');
  inputs.forEach(input => {
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handleSearch();
      }
    });
  });

  console.log('CodeMind инициализирован');
}

/**
 * Главный обработчик поиска
 * Оркестрирует весь процесс: GitHub API → эмбеддинги → поиск → отображение
 */
export async function handleSearch() {
  const usernameInput = document.getElementById('username');
  const tokenInput = document.getElementById('token');
  const queryInput = document.getElementById('query');
  const searchBtn = document.getElementById('search-btn');

  if (!usernameInput || !tokenInput || !queryInput || !searchBtn) {
    showError('Не найдены необходимые элементы интерфейса');
    return;
  }

  const username = usernameInput.value.trim();
  const token = tokenInput.value.trim() || null;
  const query = queryInput.value.trim();

  // Валидация
  if (!username) {
    showError('Введите GitHub username');
    return;
  }

  if (!query) {
    showError('Введите поисковый запрос');
    return;
  }

  // Сохраняем токен в localStorage (если введён)
  if (token) {
    localStorage.setItem(STORAGE_KEY, token);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }

  // Блокируем кнопку на время поиска
  searchBtn.disabled = true;
  searchBtn.textContent = 'Поиск...';

  try {
    // Шаг 1: Получаем список репозиториев
    showProgress(0, 1, 'Получение списка репозиториев...');
    const repos = await fetchRepos(username, token);

    if (repos.length === 0) {
      showError(`У пользователя "${username}" нет репозиториев`);
      hideProgress();
      return;
    }

    console.log(`Найдено ${repos.length} репозиториев`);

    // Шаг 2: Для каждого репозитория получаем файлы и эмбеддинги
    const allCachedData = [];
    const totalRepos = repos.length;

    for (let i = 0; i < totalRepos; i++) {
      const repo = repos[i];
      const repoName = repo.name;
      const defaultBranch = repo.default_branch || 'main';

      showProgress(i + 1, totalRepos, `Обработка репозитория: ${repoName}`);

      try {
        // Проверяем кеш
        const cacheKey = `${username}/${repoName}`;
        const cached = await getEmbeddings(cacheKey);

        if (cached) {
          console.log(`Используем кеш для ${repoName}`);
          allCachedData.push(cached);
          continue;
        }

        // Получаем список файлов кода
        const files = await fetchCodeFiles(username, repoName, defaultBranch, token);

        if (files.length === 0) {
          console.log(`В ${repoName} нет файлов кода`);
          continue;
        }

        console.log(`В ${repoName} найдено ${files.length} файлов кода`);

        // Для каждого файла получаем содержимое и извлекаем блоки кода
        const fileData = [];
        const totalFiles = files.length;

        for (let j = 0; j < totalFiles; j++) {
          const file = files[j];

          try {
            const content = await fetchFileContent(username, repoName, file.path, token);
            const blocks = extractCodeBlocks(content, detectLanguage(file.path));

            if (blocks.length > 0) {
              fileData.push({
                path: file.path,
                blocks
              });
            }
          } catch (error) {
            console.warn(`Ошибка чтения файла ${file.path}:`, error.message);
          }
        }

        if (fileData.length === 0) {
          continue;
        }

        // Получаем эмбеддинги для всех блоков кода
        const allBlocks = fileData.flatMap(f => f.blocks);
        const texts = allBlocks.map(b => b.code);

        showProgress(0, texts.length, `Получение эмбеддингов для ${repoName}...`);

        const embeddings = await getEmbeddingsBatch(texts, (current, total) => {
          showProgress(current, total, `Эмбеддинги: ${repoName} (${current}/${total})`);
        });

        // Привязываем эмбеддинги к блокам
        let blockIndex = 0;
        for (const file of fileData) {
          for (const block of file.blocks) {
            block.embedding = embeddings[blockIndex];
            blockIndex++;
          }
        }

        // Сохраняем в кеш
        const cacheData = {
          repo: `${username}/${repoName}`,
          files: fileData
        };

        await saveEmbeddings(cacheKey, cacheData);
        allCachedData.push(cacheData);

      } catch (error) {
        console.warn(`Ошибка обработки репозитория ${repoName}:`, error.message);
      }
    }

    // Шаг 3: Получаем эмбеддинг для поискового запроса
    showProgress(0, 1, 'Анализ поискового запроса...');
    const
