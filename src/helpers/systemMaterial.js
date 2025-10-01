const os = require("os");
const { nativeTheme } = require("electron");

const MaterialResult = Object.freeze({
  APPLIED: "applied",
  FALLBACK: "fallback",
  DISABLED: "disabled",
});

const FallbackReason = Object.freeze({
  FEATURE_FLAG_DISABLED: "feature_flag_disabled",
  WIN_VERSION: "win_version",
  WIN_TRANSPARENCY_DISABLED: "win_transparency_disabled",
  MAC_VIBRANCY_ERROR: "mac_vibrancy_error",
  API_UNAVAILABLE: "api_unavailable",
  FORCE_FLAT_THEME: "force_flat_theme",
});

const MIN_WIN_BUILD_FOR_MATERIAL = 22621;
const DEBOUNCE_INTERVAL_MS = 200;

const pendingApplications = new Map();

function performApply(window, options) {
  const {
    logger,
    featureEnabled = true,
    material = "mica",
    fallbackColor = "#1f2937",
    vibrancyTheme = "under-window",
    visualEffectState = "followWindow",
    forceFlat = false,
  } = options;

  if (!window || window.isDestroyed?.()) {
    return {
      result: MaterialResult.FALLBACK,
      appliedMaterial: "none",
      fallbackReason: FallbackReason.API_UNAVAILABLE,
    };
  }

  if (!featureEnabled) {
    window.setBackgroundColor(fallbackColor);
    return {
      result: MaterialResult.DISABLED,
      appliedMaterial: "none",
      fallbackReason: FallbackReason.FEATURE_FLAG_DISABLED,
    };
  }

  const platform = process.platform;
  const payload = {
    requestedMaterial: material,
    platform,
    fallbackColor,
    forceFlat,
  };

  let result = {
    result: MaterialResult.FALLBACK,
    appliedMaterial: "none",
    fallbackReason: FallbackReason.API_UNAVAILABLE,
  };

  if (forceFlat) {
    window.setBackgroundColor(fallbackColor);
    window.setVibrancy?.(null);
    if (typeof window.setBackgroundMaterial === "function") {
      window.setBackgroundMaterial("none");
    }
    result = {
      result: MaterialResult.FALLBACK,
      appliedMaterial: "none",
      fallbackReason: FallbackReason.FORCE_FLAT_THEME,
    };
  } else if (platform === "win32") {
    const release = os.release().split(".");
    const buildNumber = parseInt(release[2] || "0", 10);

    if (Number.isNaN(buildNumber) || buildNumber < MIN_WIN_BUILD_FOR_MATERIAL) {
      window.setBackgroundColor(fallbackColor);
      result = {
        result: MaterialResult.FALLBACK,
        appliedMaterial: "none",
        fallbackReason: FallbackReason.WIN_VERSION,
      };
    } else if (nativeTheme?.shouldUseHighContrastColors) {
      window.setBackgroundColor(fallbackColor);
      result = {
        result: MaterialResult.FALLBACK,
        appliedMaterial: "none",
        fallbackReason: FallbackReason.WIN_TRANSPARENCY_DISABLED,
      };
    } else if (typeof window.setBackgroundMaterial !== "function") {
      window.setBackgroundColor(fallbackColor);
      result = {
        result: MaterialResult.FALLBACK,
        appliedMaterial: "none",
        fallbackReason: FallbackReason.API_UNAVAILABLE,
      };
    } else {
      const requested = material === "auto" ? "mica" : material;
      try {
        window.setBackgroundColor("#00000000");
        window.setBackgroundMaterial(requested || "mica");
        result = {
          result: MaterialResult.APPLIED,
          appliedMaterial: requested || "mica",
        };
      } catch (error) {
        window.setBackgroundColor(fallbackColor);
        result = {
          result: MaterialResult.FALLBACK,
          appliedMaterial: "none",
          fallbackReason: FallbackReason.API_UNAVAILABLE,
          error: error.message,
        };
      }
    }
  } else if (platform === "darwin") {
    if (typeof window.setVibrancy !== "function") {
      window.setBackgroundColor(fallbackColor);
      result = {
        result: MaterialResult.FALLBACK,
        appliedMaterial: "none",
        fallbackReason: FallbackReason.API_UNAVAILABLE,
      };
    } else {
      try {
        window.setBackgroundColor("#00000000");
        window.setVibrancy({
          theme: vibrancyTheme,
          state: visualEffectState,
        });
        result = {
          result: MaterialResult.APPLIED,
          appliedMaterial: vibrancyTheme,
        };
      } catch (error) {
        window.setBackgroundColor(fallbackColor);
        window.setVibrancy(null);
        result = {
          result: MaterialResult.FALLBACK,
          appliedMaterial: "none",
          fallbackReason: FallbackReason.MAC_VIBRANCY_ERROR,
          error: error.message,
        };
      }
    }
  } else {
    window.setBackgroundColor(fallbackColor);
    result = {
      result: MaterialResult.FALLBACK,
      appliedMaterial: "none",
      fallbackReason: FallbackReason.API_UNAVAILABLE,
    };
  }

  if (logger?.info) {
    const logPayload = {
      ...payload,
      ...result,
      timestamp: Date.now(),
    };
    logger.info("system-material", logPayload);
  }

  return result;
}

function applySystemMaterial(window, options = {}) {
  const windowId = window?.id;
  const deferred = pendingApplications.get(windowId);

  return new Promise((resolve) => {
    if (deferred) {
      clearTimeout(deferred.timer);
      deferred.options = { ...deferred.options, ...options };
      deferred.resolvers.push(resolve);
      deferred.timer = setTimeout(() => {
        flushApplication(windowId);
      }, DEBOUNCE_INTERVAL_MS);
      return;
    }

    const timer = setTimeout(() => {
      flushApplication(windowId);
    }, DEBOUNCE_INTERVAL_MS);

    pendingApplications.set(windowId, {
      window,
      options,
      resolvers: [resolve],
      timer,
    });
  });
}

function flushApplication(windowId) {
  const pending = pendingApplications.get(windowId);
  if (!pending) {
    return;
  }

  pendingApplications.delete(windowId);
  const { window, options, resolvers } = pending;
  const result = performApply(window, options);
  resolvers.forEach((resolve) => resolve(result));
}

module.exports = {
  applySystemMaterial,
  MaterialResult,
  FallbackReason,
};
