import React, { useEffect, useState } from "react";
import "./index.css";
import CapsuleApp from "./components/capsule/CapsuleApp";
import LegacyApp from "./LegacyApp.jsx";

const defaultFeatureState = {
  enabled: false,
  ready: false,
};

export default function App() {
  const [featureState, setFeatureState] = useState(defaultFeatureState);

  useEffect(() => {
    let mounted = true;

    const loadFeatureState = async () => {
      try {
        if (window.electronAPI?.getSystemMaterialState) {
          const state = await window.electronAPI.getSystemMaterialState();
          if (mounted) {
            setFeatureState({
              enabled: state?.featureEnabled !== false,
              ready: true,
            });
          }
        } else if (mounted) {
          setFeatureState({ enabled: false, ready: true });
        }
      } catch (error) {
        if (mounted) {
          setFeatureState({ enabled: false, ready: true });
        }
      }
    };

    loadFeatureState();

    const unsubscribe = window.electronAPI?.onSystemMaterialState?.((payload) => {
      if (!mounted) {
        return;
      }
      if (typeof payload?.featureEnabled === "boolean") {
        setFeatureState((prev) => ({
          ...prev,
          enabled: payload.featureEnabled,
        }));
      }
    });

    return () => {
      mounted = false;
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  if (!featureState.ready) {
    return null;
  }

  if (featureState.enabled) {
    return <CapsuleApp />;
  }

  return <LegacyApp />;
}
