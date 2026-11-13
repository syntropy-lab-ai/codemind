/**
 * app.js — главный модуль приложения CodeMind
 * Инициализирует приложение и оркестрирует все операции поиска
 */

import { fetchRepos, fetchCodeFiles, fetchFileContent } from './github.js';
import { getEmbedding, getEmbeddingsBatch, extractCodeBlocks, warmup, getMode } from './embeddings.js';
import { saveEmbeddings, getEmbeddings } from './cache.js';
import { search } from './search.js';
import { showProgress, hideProgress, displayResults, showError } from './ui.js';

const STORAGE_KEY = 'github_token';

/**
 * Инициализация приложения при загрузке страницы
 */
export function init() {
  const savedToken = localStorage.getItem(STORAGE_KEY);
  if (savedToken) {
    const tokenInput = document.getElementById('token');
    if (tokenInput) tokenInput.value = savedToken;
  }

  const searchBtn = document.getElementById('search-btn');
  if (searchBtn) searchBtn.addEventListener('click', handleSearch);

  document.querySelectorAll('input').forEach(input => {
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleSearch();
    });
  });

  console.log('CodeMind инициализирован');
}

/**
 * Главный обработчик поиска
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

  if (!username) { showError('Введите GitHub username'); return; }
  if (!query) { showError('Введите поисковый запрос'); return; }

  if (token) localStorage.setItem(STORAGE_KEY, token);
  else localStorage.removeItem(STORAGE_KEY);

  searchBtn.disabled = true;
  searchBtn.innerHTML = `<svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Анализ...`;

  try {
    // Прогрев модели (первый запуск может скачать ~22MB и занять время)
    showProgress(0, 1, 'Загрузка модели анализа кода...');
    await warmup();
    updateModeIndicator();

    showProgress(0, 1, 'Получение списка репозиториев...');
    const repos = await fetchRepos(username, token);

    if (repos.length === 0) {
      showError(`У пользователя "${username}" нет репозиториев`);
      hideProgress();
      return;
    }

    const allCachedData = [];
    const totalRepos = repos.length;

    for (let i = 0; i < totalRepos; i++) {
      const repo = repos[i];
      const repoName = repo.name;
      const defaultBranch = repo.default_branch || 'main';

      showProgress(i + 1, totalRepos, `Обработка репозитория: ${repoName}`);

      try {
        const cacheKey = `${username}/${repoName}`;
        const cached = await getEmbeddings(cacheKey);
        if (cached) {
          allCachedData.push(cached);
          continue;
        }

        const files = await fetchCodeFiles(username, repoName, defaultBranch, token);
        if (files.length === 0) continue;

        const fileData = [];
        for (const file of files) {
          try {
            const content = await fetchFileContent(username, repoName, file.path, token);
            const blocks = extractCodeBlocks(content, detectLanguage(file.path));
            if (blocks.length > 0) fileData.push({ path: file.path, blocks });
          } catch (err) {
            console.warn(`Ошибка чтения файла ${file.path}:`, err.message);
          }
        }

        if (fileData.length === 0) continue;

        const allBlocks = fileData.flatMap(f => f.blocks);
        const texts = allBlocks.map(b => b.code);

        showProgress(0, texts.length, `Получение эмбеддингов для ${repoName}...`);
        const embeddings = await getEmbeddingsBatch(texts, (current, total) => {
          showProgress(current, total, `Эмбеддинги: ${repoName} (${current}/${total})`);
        });

        let blockIndex = 0;
        for (const file of fileData) {
          for (const block of file.blocks) {
            block.embedding = embeddings[blockIndex];
            blockIndex++;
          }
        }

        const cacheData = { repo: `${username}/${repoName}`, files: fileData };
        await saveEmbeddings(cacheKey, cacheData);
        allCachedData.push(cacheData);

      } catch (error) {
        console.warn(`Ошибка обработки репозитория ${repoName}:`, error.message);
      }
    }

    if (allCachedData.length === 0) {
      showError('Не удалось проанализировать ни один репозиторий. Добавьте GitHub Token для увеличения лимитов API.');
      hideProgress();
      return;
    }

    showProgress(0, 1, 'Анализ поискового запроса...');
    const queryEmbedding = await getEmbedding(query);

    showProgress(0, 1, 'Поиск результатов...');
    const results = search(queryEmbedding, allCachedData, 20);

    hideProgress();
    displayResults(results);

    if (results.length === 0) {
      showError('Ничего не найдено. Попробуйте изменить запрос.');
    }

  } catch (error) {
    console.error('Критическая ошибка поиска:', error);
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('failed to fetch') || msg.includes('name_not_resolved') || msg.includes('network')) {
      showError('Ошибка сети: не удалось загрузить модель анализа. Попробуйте отключить блокировщик рекламы и повторить.');
    } else if (msg.includes('403') || msg.includes('429') || msg.includes('лимит')) {
      showError('Превышен лимит запросов GitHub. Введите GitHub Token в поле выше.');
    } else {
      showError(error.message || 'Произошла непредвиденная ошибка');
    }
    hideProgress();
  } finally {
    searchBtn.disabled = false;
    searchBtn.innerHTML = `
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      Найти
    `;
  }
}

/**
 * Показать в интерфейсе, каким режимом работает поиск
 */
function updateModeIndicator() {
  const el = document.getElementById('mode-indicator');
  if (!el) return;
  const m = getMode();
  if (m === 'transformers') el.textContent = '⚡ Режим: нейросетевой поиск (модель в браузере)';
  else if (m === 'fallback') el.textContent = '🛡 Режим: лексический поиск (нейросеть недоступна — работает офлайн)';
  else el.textContent = '';
}

/**
 * Определить язык программирования по расширению файла
 */
function detectLanguage(path) {
  const ext = path.split('.').pop().toLowerCase();
  const map = {
    js: 'javascript', jsx: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    py: 'python',
    html: 'javascript', css: 'javascript'
  };
  return map[ext] || 'javascript';
}

// Запускаем инициализацию при загрузке страницы
init();
