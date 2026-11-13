/**
 * github.js — модуль для работы с GitHub REST API
 * Получает список репозиториев и содержимое файлов
 */

const GITHUB_API_BASE = 'https://api.github.com';

/**
 * Получить список репозиториев пользователя
 * @param {string} username — GitHub username
 * @param {string|null} token — опциональный токен для доступа к приватным репо
 * @returns {Promise<Array>} — массив объектов репозиториев
 */
export async function fetchRepos(username, token = null) {
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'CodeMind-App'
  };

  if (token) {
    headers['Authorization'] = `token ${token}`;
  }

  const response = await fetch(
    `${GITHUB_API_BASE}/users/${username}/repos?per_page=100&type=all`,
    { headers }
  );

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Неверный GitHub токен. Проверьте правильность ввода.');
    }
    if (response.status === 403) {
      throw new Error('Превышен лимит запросов GitHub API. Попробуйте через час или добавьте токен.');
    }
    if (response.status === 404) {
      throw new Error(`Пользователь "${username}" не найден.`);
    }
    throw new Error(`Ошибка GitHub API: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Получить дерево файлов репозитория (рекурсивно)
 * @param {string} owner — владелец репозитория
 * @param {string} repo — имя репозитория
 * @param {string} branch — ветка (обычно 'main' или 'master')
 * @param {string|null} token — опциональный токен
 * @returns {Promise<Object>} — объект с деревом файлов
 */
export async function fetchRepoTree(owner, repo, branch = 'main', token = null) {
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'CodeMind-App'
  };

  if (token) {
    headers['Authorization'] = `token ${token}`;
  }

  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    { headers }
  );

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Неверный GitHub токен.');
    }
    if (response.status === 403) {
      throw new Error('Превышен лимит запросов GitHub API.');
    }
    if (response.status === 404) {
      throw new Error(`Репозиторий "${owner}/${repo}" не найден или ветка "${branch}" не существует.`);
    }
    throw new Error(`Ошибка GitHub API: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Получить содержимое файла из репозитория
 * @param {string} owner — владелец репозитория
 * @param {string} repo — имя репозитория
 * @param {string} path — путь к файлу
 * @param {string|null} token — опциональный токен
 * @returns {Promise<string>} — содержимое файла (декодированное из base64)
 */
export async function fetchFileContent(owner, repo, path, token = null) {
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'CodeMind-App'
  };

  if (token) {
    headers['Authorization'] = `token ${token}`;
  }

  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${path}`,
    { headers }
  );

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Неверный GitHub токен.');
    }
    if (response.status === 403) {
      throw new Error('Превышен лимит запросов GitHub API.');
    }
    if (response.status === 404) {
      throw new Error(`Файл "${path}" не найден в репозитории "${owner}/${repo}".`);
    }
    throw new Error(`Ошибка GitHub API: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  // GitHub возвращает содержимое в base64
  if (data.encoding === 'base64' && data.content) {
    // Декодируем base64 в UTF-8
    const binaryString = atob(data.content);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
  }

  throw new Error(`Файл "${path}" не содержит текстового содержимого.`);
}

/**
 * Получить список файлов репозитория, подходящих для анализа кода
 * @param {string} owner — владелец репозитория
 * @param {string} repo — имя репозитория
 * @param {string} branch — ветка
 * @param {string|null} token — опциональный токен
 * @returns {Promise<Array>} — массив объектов {path, type}
 */
export async function fetchCodeFiles(owner, repo, branch = 'main', token = null) {
  const tree = await fetchRepoTree(owner, repo, branch, token);

  if (!tree.tree || !Array.isArray(tree.tree)) {
    return [];
  }

  // Фильтруем только файлы кода (игнорируем бинарные файлы, зависимости и т.д.)
  const codeExtensions = ['.js', '.ts', '.py', '.java', '.cpp', '.c', '.h', '.cs', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.scala', '.r', '.m', '.mm', '.html', '.css', '.scss', '.less', '.vue', '.jsx', '.tsx', '.sh', '.bash', '.zsh', '.sql', '.md'];
  const ignorePaths = ['node_modules/', 'vendor/', 'dist/', 'build/', '.git/', '__pycache__/', '.venv/', 'venv/', 'target/', 'bin/', 'obj/', '.next/', '.nuxt/', 'public/', 'static/', 'assets/', 'images/', 'img/', 'fonts/', 'docs/', 'test/', 'tests/', 'spec/', 'specs/', '.github/', '.gitlab/', '.vscode/', '.idea/'];

  return tree.tree
    .filter(item => item.type === 'blob')
    .filter(item => {
      const path = item.path.toLowerCase();
      // Проверяем расширение
      const hasCodeExtension = codeExtensions.some(ext => path.endsWith(ext));
      if (!hasCodeExtension) return false;
