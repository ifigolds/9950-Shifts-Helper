const DEFAULT_MINI_APP_URL = 'https://9950-shifts-helper.vercel.app';

function normalizeUrl(url) {
  const value = String(url || '').trim();
  return value ? value.replace(/\/+$/, '') : '';
}

function looksLikeTemporaryUrl(url) {
  return /localhost|127\.0\.0\.1|ngrok|localtunnel|\.test(?::|$)/i.test(String(url || ''));
}

function getMiniAppBaseUrl() {
  const explicitUrl = normalizeUrl(process.env.MINI_APP_URL || process.env.WEB_APP_URL);
  if (explicitUrl) {
    return explicitUrl;
  }

  const legacyUrl = normalizeUrl(process.env.BASE_URL);
  if (legacyUrl && !looksLikeTemporaryUrl(legacyUrl)) {
    return legacyUrl;
  }

  return DEFAULT_MINI_APP_URL;
}

function getCacheBuster() {
  return String(
    process.env.RENDER_GIT_COMMIT ||
      process.env.RENDER_GIT_COMMIT_SHA ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.GIT_COMMIT_SHA ||
      ''
  )
    .trim()
    .slice(0, 12);
}

function buildUrl(pathname = '/', includeVersion = false) {
  const url = new URL(pathname, `${getMiniAppBaseUrl()}/`);

  if (includeVersion) {
    const cacheBuster = getCacheBuster();
    if (cacheBuster) {
      url.searchParams.set('v', cacheBuster);
    }
  }

  return url.toString();
}

function getMiniAppUrl() {
  return buildUrl('/', true);
}

function getTemplateUrl() {
  return buildUrl('/shift-import-template.xlsx');
}

module.exports = {
  DEFAULT_MINI_APP_URL,
  getMiniAppBaseUrl,
  getMiniAppUrl,
  getTemplateUrl,
};
