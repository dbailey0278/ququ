import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Mic, MicOff, Settings, History } from "lucide-react";
import { pxAlign } from "../../utils/pxAlign";
import { useRecording } from "../../hooks/useRecording";
import { useModelStatus } from "../../hooks/useModelStatus";
import { useHotkey } from "../../hooks/useHotkey";

const defaultTokens = {
  surface: "rgba(248, 250, 252, 0.94)",
  text: "rgba(15, 23, 42, 0.92)",
  divider: "rgba(148, 163, 184, 0.35)",
  shadow: "rgba(15, 23, 42, 0.18)",
  highContrast: false,
  forceFlat: false,
};

function applyThemeTokens(tokens) {
  const root = document.documentElement;
  if (!root) {
    return;
  }

  root.style.setProperty("--surface", tokens.surface);
  root.style.setProperty("--text", tokens.text);
  root.style.setProperty("--divider", tokens.divider);
  root.style.setProperty("--shadow", tokens.shadow);

  if (tokens.highContrast) {
    root.setAttribute("data-high-contrast", "true");
  } else {
    root.removeAttribute("data-high-contrast");
  }

  if (tokens.forceFlat) {
    root.setAttribute("data-force-flat", "true");
  } else {
    root.removeAttribute("data-force-flat");
  }
}

function getStatusMessage({
  modelStatus,
  isRecording,
  isProcessing,
  isOptimizing,
  processedText,
  hotkey,
}) {
  if (!modelStatus.isReady) {
    if (modelStatus.stage === "need_download") {
      return "需要下载模型文件";
    }
    if (modelStatus.stage === "downloading") {
      const progress = modelStatus.downloadProgress || 0;
      return `模型下载中 ${progress}%`;
    }
    if (modelStatus.stage === "loading") {
      return "模型加载中";
    }
    if (modelStatus.stage === "error") {
      return `模型错误: ${modelStatus.error}`;
    }
    return "模型准备中";
  }

  if (isRecording) {
    return "正在录音...";
  }

  if (isProcessing) {
    return "识别语音中";
  }

  if (isOptimizing) {
    return "AI 优化中";
  }

  if (processedText) {
    return "AI 优化完成并已粘贴";
  }

  return `点击或按 ${hotkey} 开始`; 
}

function getCapsuleState({ modelStatus, isRecording, isProcessing, isOptimizing }) {
  if (!modelStatus.isReady) {
    return "inactive";
  }
  if (modelStatus.stage === "error") {
    return "error";
  }
  if (isRecording) {
    return "recording";
  }
  if (isProcessing || isOptimizing) {
    return "processing";
  }
  return "idle";
}

const CapsuleApp = () => {
  const capsuleRef = useRef(null);
  const [processedText, setProcessedText] = useState("");
  const [originalText, setOriginalText] = useState("");
  const lastPasteRef = useRef({ text: "", timestamp: 0 });

  const modelStatus = useModelStatus();
  const {
    isRecording,
    isProcessing,
    isOptimizing,
    startRecording,
    stopRecording,
    error: recordingError,
  } = useRecording();

  const { hotkey, syncRecordingState, registerHotkey } = useHotkey();

  const safePaste = useCallback(async (text) => {
    if (!text) {
      return;
    }

    const now = Date.now();
    const lastPaste = lastPasteRef.current;
    if (lastPaste.text === text && now - lastPaste.timestamp < 1000) {
      return;
    }

    lastPasteRef.current = { text, timestamp: now };

    try {
      if (window.electronAPI) {
        await window.electronAPI.pasteText(text);
        toast.success("文本已自动粘贴");
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        toast.info("文本已复制到剪贴板");
      }
    } catch (error) {
      toast.error("粘贴失败", {
        description: "请检查辅助功能权限，文本已复制到剪贴板",
      });
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      }
    }
  }, []);

  const handleRecordingComplete = useCallback((transcriptionResult) => {
    if (transcriptionResult?.success && transcriptionResult.text) {
      setOriginalText(transcriptionResult.text);
      setProcessedText("");
      toast.success("语音识别完成，AI 正在优化文本...");
    }
  }, []);

  const handleAIOptimizationComplete = useCallback(async (optimizedResult) => {
    if (optimizedResult?.success && optimizedResult.text) {
      setProcessedText(optimizedResult.text);
      await safePaste(optimizedResult.text);
    } else if (originalText) {
      await safePaste(originalText);
    }
  }, [originalText, safePaste]);

  useEffect(() => {
    document.documentElement.setAttribute("data-capsule", "true");
    document.body?.setAttribute("data-capsule", "true");
    window.onTranscriptionComplete = handleRecordingComplete;
    window.onAIOptimizationComplete = handleAIOptimizationComplete;
    return () => {
      document.documentElement.removeAttribute("data-capsule");
      document.body?.removeAttribute("data-capsule");
      window.onTranscriptionComplete = null;
      window.onAIOptimizationComplete = null;
    };
  }, [handleRecordingComplete, handleAIOptimizationComplete]);

  useEffect(() => {
    if (recordingError) {
      toast.error(recordingError);
    }
  }, [recordingError]);

  const toggleRecording = useCallback(() => {
    if (!modelStatus.isReady) {
      if (modelStatus.stage === "need_download") {
        toast.warning("请先下载模型文件");
      } else if (modelStatus.stage === "downloading") {
        toast.warning(`模型下载中 ${modelStatus.downloadProgress || 0}%`);
      } else if (modelStatus.stage === "loading") {
        toast.warning("模型加载中，请稍候...");
      } else if (modelStatus.stage === "error") {
        toast.error(`模型错误: ${modelStatus.error}`);
      } else {
        toast.warning("模型未就绪，请稍候...");
      }
      return;
    }

    if (!isRecording && !isProcessing) {
      startRecording();
    } else if (isRecording) {
      stopRecording();
    }
  }, [modelStatus, isRecording, isProcessing, startRecording, stopRecording]);

  useEffect(() => {
    const element = capsuleRef.current;
    if (!element) {
      return undefined;
    }

    pxAlign(element);

    const handleResize = () => {
      pxAlign(element);
    };

    window.addEventListener("resize", handleResize);
    const unsubscribeMetrics = window.electronAPI?.onCapsuleMetrics?.((payload) => {
      pxAlign(element, { scaleFactor: payload?.scaleFactor });
    });

    return () => {
      window.removeEventListener("resize", handleResize);
      if (unsubscribeMetrics) {
        unsubscribeMetrics();
      }
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const fetchInitialState = async () => {
      try {
        const state = await window.electronAPI?.getSystemMaterialState?.();
        if (state && mounted) {
          const tokens = { ...defaultTokens, ...(state.tokens || {}) };
          applyThemeTokens(tokens);
        }
      } catch (error) {
        if (window.electronAPI?.log) {
          window.electronAPI.log("warn", `获取系统材质状态失败: ${error.message}`);
        }
      }
    };

    fetchInitialState();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const unsubscribeTheme = window.electronAPI?.onCapsuleTheme?.((payload) => {
      const tokens = { ...defaultTokens, ...(payload?.tokens || {}) };
      applyThemeTokens(tokens);
    });

    const unsubscribeMaterial = window.electronAPI?.onSystemMaterialState?.(() => {
      // no-op for now, reserved for future telemetry or UI badges
    });

    return () => {
      if (unsubscribeTheme) {
        unsubscribeTheme();
      }
      if (unsubscribeMaterial) {
        unsubscribeMaterial();
      }
    };
  }, []);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const isControlPanel = urlParams.get("panel") === "control";
    if (isControlPanel) {
      return undefined;
    }

    const register = async () => {
      if (registerHotkey) {
        try {
          await registerHotkey("CommandOrControl+Shift+Space");
        } catch (error) {
          if (window.electronAPI?.log) {
            window.electronAPI.log("error", `热键注册失败: ${error.message}`);
          }
        }
      }
    };

    register();

    const unsubscribeHotkey = window.electronAPI?.onHotkeyTriggered?.(() => {
      toggleRecording();
    });

    const unsubscribeToggle = window.electronAPI?.onToggleDictation?.(() => {
      toggleRecording();
    });

    return () => {
      if (unsubscribeHotkey) {
        unsubscribeHotkey();
      }
      if (unsubscribeToggle) {
        unsubscribeToggle();
      }
    };
  }, [registerHotkey, toggleRecording]);

  useEffect(() => {
    if (syncRecordingState) {
      syncRecordingState(isRecording);
    }
  }, [isRecording, syncRecordingState]);

  const statusMessage = useMemo(() => {
    return getStatusMessage({
      modelStatus,
      isRecording,
      isProcessing,
      isOptimizing,
      processedText,
      hotkey,
    });
  }, [modelStatus, isRecording, isProcessing, isOptimizing, processedText, hotkey]);

  const capsuleState = useMemo(() => {
    return getCapsuleState({ modelStatus, isRecording, isProcessing, isOptimizing });
  }, [modelStatus, isRecording, isProcessing, isOptimizing]);

  const handleOpenSettings = useCallback(() => {
    if (window.electronAPI?.openSettingsWindow) {
      window.electronAPI.openSettingsWindow();
    }
  }, []);

  const handleOpenHistory = useCallback(() => {
    if (window.electronAPI?.openHistoryWindow) {
      window.electronAPI.openHistoryWindow();
    }
  }, []);

  return (
    <div className="capsule-root" data-drag="true">
      <div ref={capsuleRef} className="capsule-surface" data-drag="true">
        <div className="capsule-status" data-drag="true" data-state={capsuleState}>
          <span className="capsule-indicator" aria-hidden="true" />
          <span className="capsule-text" title={statusMessage}>
            {statusMessage}
          </span>
        </div>
        <button
          type="button"
          className="capsule-mic" 
          data-drag="false"
          onClick={toggleRecording}
          aria-label={isRecording ? "停止录音" : "开始录音"}
        >
          {isRecording ? <MicOff className="capsule-mic-icon" /> : <Mic className="capsule-mic-icon" />}
        </button>
        <div className="capsule-actions" data-drag="false">
          <button
            type="button"
            className="capsule-action"
            data-drag="false"
            onClick={handleOpenHistory}
            aria-label="打开历史记录"
          >
            <History className="capsule-action-icon" />
          </button>
          <button
            type="button"
            className="capsule-action"
            data-drag="false"
            onClick={handleOpenSettings}
            aria-label="打开设置"
          >
            <Settings className="capsule-action-icon" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default CapsuleApp;
