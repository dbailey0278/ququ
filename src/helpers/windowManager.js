const { BrowserWindow, nativeTheme, screen, systemPreferences, app } = require("electron");
const path = require("path");
const { applySystemMaterial } = require("./systemMaterial");

class WindowManager {
  constructor(options = {}) {
    this.mainWindow = null;
    this.controlPanelWindow = null;
    this.historyWindow = null;
    this.settingsWindow = null;

    this.logger = options.logger || null;
    this.environmentManager = options.environmentManager || null;

    this.pendingIpcMessages = [];

    this.systemMaterialState = {
      featureEnabled: this.resolveFeatureFlag(options.featureEnabled),
      material: process.platform === "win32" ? "mica" : "vibrancy",
      vibrancyTheme: "under-window",
      lastResult: null,
      fallbackReason: null,
      tokens: null,
      forceFlat: false,
    };

    this.registerSystemListeners();
  }

  resolveFeatureFlag(explicit) {
    if (typeof explicit === "boolean") {
      return explicit;
    }
    if (this.environmentManager?.isSystemMaterialCapsuleEnabled) {
      return this.environmentManager.isSystemMaterialCapsuleEnabled();
    }
    return true;
  }

  registerSystemListeners() {
    if (nativeTheme) {
      nativeTheme.on("updated", () => {
        this.refreshSystemMaterial("native-theme");
      });
    }

    if (screen) {
      screen.on("display-metrics-changed", (_event, display, changedMetrics) => {
        this.handleDisplayMetrics(display, changedMetrics);
      });
    }

    if (app) {
      app.on("accessibility-support-changed", () => {
        this.refreshSystemMaterial("accessibility-support");
      });
    }

    if (process.platform === "darwin" && systemPreferences?.subscribeNotification) {
      try {
        systemPreferences.subscribeNotification("AppleReduceTransparencyChangedNotification", () => {
          this.refreshSystemMaterial("mac-reduce-transparency");
        });
        systemPreferences.subscribeNotification("AppleIncreaseContrastChangedNotification", () => {
          this.refreshSystemMaterial("mac-increase-contrast");
        });
      } catch (error) {
        if (this.logger && typeof this.logger.warn === "function") {
          this.logger.warn("macOS accessibility subscription failed", { error: error.message });
        }
      }
    }
  }

  dispatchToMainWindow(channel, payload) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return false;
    }

    const webContents = this.mainWindow.webContents;
    if (!webContents || webContents.isDestroyed()) {
      return false;
    }

    if (typeof webContents.isLoadingMainFrame === "function" && webContents.isLoadingMainFrame()) {
      this.pendingIpcMessages.push({ channel, payload });
      return false;
    }

    try {
      webContents.send(channel, payload);
      return true;
    } catch (error) {
      if (this.logger && typeof this.logger.warn === "function") {
        this.logger.warn("Failed to send IPC message", { channel, error: error.message });
      }
      return false;
    }
  }

  flushPendingIpc() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }

    const webContents = this.mainWindow.webContents;
    if (!webContents || webContents.isDestroyed()) {
      return;
    }

    while (this.pendingIpcMessages.length > 0) {
      const message = this.pendingIpcMessages.shift();
      try {
        webContents.send(message.channel, message.payload);
      } catch (error) {
        if (this.logger && typeof this.logger.warn === "function") {
          this.logger.warn("Failed to flush IPC message", { channel: message.channel, error: error.message });
        }
      }
    }
  }

  async createMainWindow() {
    if (this.mainWindow) {
      this.mainWindow.focus();
      return this.mainWindow;
    }

    const isWindows = process.platform === "win32";
    const browserOptions = {
      width: 320,
      height: 40,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      movable: true,
      alwaysOnTop: true,
      backgroundColor: "#00000000",
      roundedCorners: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, "..", "..", "preload.js"),
      },
    };

    if (isWindows) {
      browserOptions.backgroundMaterial = this.systemMaterialState.material || "mica";
    }

    if (process.platform === "darwin") {
      browserOptions.vibrancy = this.systemMaterialState.vibrancyTheme;
      browserOptions.visualEffectState = "followWindow";
      browserOptions.titleBarStyle = "hidden";
    }

    this.mainWindow = new BrowserWindow(browserOptions);
    this.mainWindow.setMenuBarVisibility(false);

    const isDev = process.env.NODE_ENV === "development";

    if (isDev) {
      await this.mainWindow.loadURL("http://localhost:5173");
    } else {
      await this.mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
    }

    this.mainWindow.on("closed", () => {
      this.mainWindow = null;
    });

    this.mainWindow.webContents.once("did-finish-load", () => {
      this.flushPendingIpc();
      this.emitCapsuleMetrics("ready");
      this.refreshSystemMaterial("initial");
    });

    this.refreshSystemMaterial("create");

    return this.mainWindow;
  }

  emitCapsuleMetrics(reason = "initial") {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }

    const bounds = this.mainWindow.getBounds();
    let scaleFactor = 1;
    if (screen && typeof screen.getDisplayMatching === "function") {
      const display = screen.getDisplayMatching(bounds);
      if (display?.scaleFactor) {
        scaleFactor = display.scaleFactor;
      }
    }

    this.dispatchToMainWindow("capsule:metrics", {
      reason,
      bounds,
      scaleFactor,
    });
  }

  computeThemeTokens() {
    const dark = Boolean(nativeTheme?.shouldUseDarkColors);
    const highContrast = Boolean(nativeTheme?.shouldUseHighContrastColors);

    let reduceTransparency = false;
    let increaseContrast = false;

    if (process.platform === "darwin" && systemPreferences?.getUserDefault) {
      try {
        reduceTransparency = Boolean(systemPreferences.getUserDefault("reduceTransparency", "boolean"));
      } catch (error) {
        if (this.logger && typeof this.logger.debug === "function") {
          this.logger.debug("reduceTransparency lookup failed", { error: error.message });
        }
      }

      try {
        increaseContrast = Boolean(systemPreferences.getUserDefault("increaseContrast", "boolean"));
      } catch (error) {
        if (this.logger && typeof this.logger.debug === "function") {
          this.logger.debug("increaseContrast lookup failed", { error: error.message });
        }
      }
    }

    const baseLight = {
      surface: "rgba(248, 250, 252, 0.94)",
      text: "rgba(15, 23, 42, 0.92)",
      divider: "rgba(148, 163, 184, 0.35)",
      shadow: "rgba(15, 23, 42, 0.18)",
    };

    const baseDark = {
      surface: "rgba(15, 23, 42, 0.82)",
      text: "rgba(226, 232, 240, 0.96)",
      divider: "rgba(71, 85, 105, 0.65)",
      shadow: "rgba(2, 6, 23, 0.75)",
    };

    const tokens = dark ? { ...baseDark } : { ...baseLight };

    if (highContrast || increaseContrast) {
      tokens.surface = dark ? "#000000" : "#ffffff";
      tokens.text = dark ? "#ffffff" : "#000000";
      tokens.divider = dark ? "rgba(255, 255, 255, 0.75)" : "rgba(0, 0, 0, 0.75)";
      tokens.shadow = dark ? "rgba(0, 0, 0, 0.8)" : "rgba(0, 0, 0, 0.45)";
    } else if (reduceTransparency) {
      tokens.surface = dark ? "rgba(15, 23, 42, 0.96)" : "rgba(248, 250, 252, 0.98)";
      tokens.shadow = dark ? "rgba(0, 0, 0, 0.7)" : "rgba(15, 23, 42, 0.28)";
    }

    const forceFlat = Boolean(highContrast || reduceTransparency || increaseContrast);

    return {
      ...tokens,
      dark,
      highContrast,
      reduceTransparency,
      increaseContrast,
      forceFlat,
    };
  }

  refreshSystemMaterial(reason = "manual", overrides = {}) {
    const tokens = this.computeThemeTokens();
    this.systemMaterialState.tokens = tokens;

    const featureEnabled =
      overrides.featureEnabled !== undefined
        ? overrides.featureEnabled
        : this.systemMaterialState.featureEnabled;
    const requestedMaterial = overrides.material || this.systemMaterialState.material;
    const vibrancyTheme = overrides.vibrancyTheme || this.systemMaterialState.vibrancyTheme;
    const forceFlat = overrides.forceFlat !== undefined ? overrides.forceFlat : tokens.forceFlat;

    this.systemMaterialState.forceFlat = forceFlat;

    this.dispatchToMainWindow("capsule:theme", {
      reason,
      tokens,
      dark: tokens.dark,
      highContrast: tokens.highContrast,
      reduceTransparency: tokens.reduceTransparency,
      increaseContrast: tokens.increaseContrast,
      forceFlat,
    });

    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return Promise.resolve({ featureEnabled, requestedMaterial, forceFlat });
    }

    return applySystemMaterial(this.mainWindow, {
      logger: this.logger,
      featureEnabled,
      material: requestedMaterial,
      fallbackColor: tokens.surface,
      vibrancyTheme,
      visualEffectState: "followWindow",
      forceFlat,
    }).then((result) => {
      this.systemMaterialState.lastResult = result.result;
      this.systemMaterialState.fallbackReason = result.fallbackReason || null;
      this.systemMaterialState.featureEnabled = featureEnabled;
      this.systemMaterialState.material = requestedMaterial;
      this.systemMaterialState.vibrancyTheme = vibrancyTheme;

      this.broadcastMaterialState(reason, result, {
        featureEnabled,
        material: requestedMaterial,
        forceFlat,
      });

      return result;
    });
  }

  broadcastMaterialState(reason, state, options) {
    this.dispatchToMainWindow("system-material:state", {
      reason,
      result: state.result,
      appliedMaterial: state.appliedMaterial,
      fallbackReason: state.fallbackReason || null,
      featureEnabled: options.featureEnabled,
      requestedMaterial: options.material,
      forceFlat: options.forceFlat,
    });
  }

  setSystemMaterial(material) {
    if (!material) {
      return this.getSystemMaterialState();
    }

    this.systemMaterialState.material = material;
    return this.refreshSystemMaterial("material-toggle", { material });
  }

  setSystemMaterialFeature(enabled) {
    this.systemMaterialState.featureEnabled = Boolean(enabled);
    return this.refreshSystemMaterial("feature-toggle", { featureEnabled: Boolean(enabled) });
  }

  getSystemMaterialState() {
    const tokens = this.systemMaterialState.tokens || this.computeThemeTokens();
    return {
      featureEnabled: this.systemMaterialState.featureEnabled,
      requestedMaterial: this.systemMaterialState.material,
      vibrancyTheme: this.systemMaterialState.vibrancyTheme,
      lastResult: this.systemMaterialState.lastResult,
      fallbackReason: this.systemMaterialState.fallbackReason,
      forceFlat: this.systemMaterialState.forceFlat,
      tokens,
    };
  }

  handleDisplayMetrics(display, changedMetrics) {
    this.emitCapsuleMetrics("display-change");
    if (display && changedMetrics?.includes?.("scaleFactor")) {
      this.refreshSystemMaterial("display-metrics");
    }
  }

  async createControlPanelWindow() {
    if (this.controlPanelWindow) {
      this.controlPanelWindow.focus();
      return this.controlPanelWindow;
    }

    this.controlPanelWindow = new BrowserWindow({
      width: 800,
      height: 600,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, "..", "..", "preload.js"),
      },
    });

    const isDev = process.env.NODE_ENV === "development";

    if (isDev) {
      await this.controlPanelWindow.loadURL("http://localhost:5173?panel=control");
    } else {
      await this.controlPanelWindow.loadFile(
        path.join(__dirname, "..", "dist", "index.html"),
        { query: { panel: "control" } }
      );
    }

    this.controlPanelWindow.on("closed", () => {
      this.controlPanelWindow = null;
    });

    return this.controlPanelWindow;
  }

  async createHistoryWindow() {
    if (this.historyWindow) {
      this.historyWindow.focus();
      return this.historyWindow;
    }

    this.historyWindow = new BrowserWindow({
      width: 1000,
      height: 700,
      show: false,
      title: "转录历史 - 蛐蛐",
      alwaysOnTop: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, "..", "..", "preload.js"),
      },
    });

    const isDev = process.env.NODE_ENV === "development";

    if (isDev) {
      await this.historyWindow.loadURL("http://localhost:5173/history.html");
    } else {
      await this.historyWindow.loadFile(
        path.join(__dirname, "..", "dist", "history.html")
      );
    }

    this.historyWindow.on("closed", () => {
      this.historyWindow = null;
    });

    return this.historyWindow;
  }

  async createSettingsWindow() {
    if (this.settingsWindow) {
      this.settingsWindow.focus();
      return this.settingsWindow;
    }

    this.settingsWindow = new BrowserWindow({
      width: 700,
      height: 600,
      show: false,
      title: "设置 - 蛐蛐",
      alwaysOnTop: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, "..", "..", "preload.js"),
      },
    });

    const isDev = process.env.NODE_ENV === "development";

    if (isDev) {
      await this.settingsWindow.loadURL("http://localhost:5173?page=settings");
    } else {
      await this.settingsWindow.loadFile(
        path.join(__dirname, "..", "dist", "settings.html")
      );
    }

    this.settingsWindow.on("closed", () => {
      this.settingsWindow = null;
    });

    return this.settingsWindow;
  }

  showControlPanel() {
    if (this.controlPanelWindow) {
      this.controlPanelWindow.show();
      this.controlPanelWindow.focus();
    } else {
      this.createControlPanelWindow().then(() => {
        if (this.controlPanelWindow) {
          this.controlPanelWindow.show();
        }
      });
    }
  }

  hideControlPanel() {
    if (this.controlPanelWindow) {
      this.controlPanelWindow.hide();
    }
  }

  showHistoryWindow() {
    if (this.historyWindow) {
      this.historyWindow.show();
      this.historyWindow.focus();
      this.historyWindow.setAlwaysOnTop(true);
    } else {
      this.createHistoryWindow().then(() => {
        if (this.historyWindow) {
          this.historyWindow.show();
          this.historyWindow.focus();
          this.historyWindow.setAlwaysOnTop(true);
        }
      });
    }
  }

  hideHistoryWindow() {
    if (this.historyWindow) {
      this.historyWindow.hide();
    }
  }

  closeHistoryWindow() {
    if (this.historyWindow) {
      this.historyWindow.close();
    }
  }

  showSettingsWindow() {
    if (this.settingsWindow) {
      this.settingsWindow.show();
      this.settingsWindow.focus();
      this.settingsWindow.setAlwaysOnTop(true);
    } else {
      this.createSettingsWindow().then(() => {
        if (this.settingsWindow) {
          this.settingsWindow.show();
          this.settingsWindow.focus();
          this.settingsWindow.setAlwaysOnTop(true);
        }
      });
    }
  }

  hideSettingsWindow() {
    if (this.settingsWindow) {
      this.settingsWindow.hide();
    }
  }

  closeSettingsWindow() {
    if (this.settingsWindow) {
      this.settingsWindow.close();
    }
  }
}

module.exports = WindowManager;
