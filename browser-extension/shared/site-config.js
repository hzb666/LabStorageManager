(function initExtensionSiteConfig(root) {
  const generatedConfig = root.ExtensionEnvConfig || {};
  const DEFAULT_SYSTEM_CONFIG = {
    systemUrl: generatedConfig.systemUrl || "http://localhost:5173",
    reagentSiteUrl: generatedConfig.reagentSiteUrl || "https://reagent.bjmu.edu.cn",
  };

  function parseHttpUrl(urlValue) {
    try {
      const parsed = new URL(urlValue);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return null;
      }
      if (!parsed.hostname || parsed.username || parsed.password) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function normalizeOrigin(urlValue, fallbackOrigin) {
    const parsed = parseHttpUrl(urlValue);
    if (parsed) {
      return parsed.origin;
    }

    const fallback = parseHttpUrl(fallbackOrigin);
    return fallback?.origin || fallbackOrigin;
  }

  function normalizeExtensionConfig(rawConfig, defaults = DEFAULT_SYSTEM_CONFIG) {
    return {
      ...defaults,
      ...rawConfig,
      systemUrl: normalizeOrigin(rawConfig?.systemUrl, defaults.systemUrl),
      reagentSiteUrl: normalizeOrigin(
        rawConfig?.reagentSiteUrl,
        defaults.reagentSiteUrl,
      ),
    };
  }

  function buildSiteUrlPattern(siteOrigin) {
    return `${normalizeOrigin(siteOrigin, DEFAULT_SYSTEM_CONFIG.reagentSiteUrl)}/*`;
  }

  function buildProductDetailUrl(siteOrigin, productId) {
    return `${normalizeOrigin(siteOrigin, DEFAULT_SYSTEM_CONFIG.reagentSiteUrl)}/Front.aspx?page=cpxq&param=${encodeURIComponent(String(productId || ""))}`;
  }

  const api = {
    DEFAULT_SYSTEM_CONFIG,
    buildProductDetailUrl,
    buildSiteUrlPattern,
    normalizeExtensionConfig,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  root.ExtensionSiteConfig = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
