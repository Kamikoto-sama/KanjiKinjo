import { useEffect, useRef, useState } from "react";
import { api, type PreparedSetup, setupPreview } from "../api";
import type { Config } from "../types";

function prepare(
  request: { current: { key: string; promise: Promise<PreparedSetup> } | null },
  config: Config,
  key: string,
) {
  if (request.current?.key === key) return request.current.promise;
  const promise = api.prepareSetup(config).catch((error) => {
    if (request.current?.promise === promise) request.current = null;
    throw error;
  });
  request.current = { key, promise };
  return promise;
}

export function useSetupPreview(
  config: Config | null,
  showUnstudied: boolean,
  hasUnstudiedData: boolean,
  snapshotVersion?: string,
) {
    const key = config ? JSON.stringify([snapshotVersion, hasUnstudiedData, config]) : "";
  const request = useRef<{
    key: string;
    promise: Promise<PreparedSetup>;
  } | null>(null);
  const [result, setResult] = useState<{
    key: string;
    prepared: PreparedSetup;
  } | null>(null);
  const [failure, setFailure] = useState<{
    key: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!config) return;
    let active = true;
    const timer = window.setTimeout(() => {
      const pending = prepare(request, config, key);
      void pending.then(
        (prepared) => {
          if (active && request.current?.promise === pending) {
            setResult({ key, prepared });
            setFailure(null);
          }
        },
        (error: unknown) => {
          if (active && !request.current)
            setFailure({
              key,
              message:
                error instanceof Error
                  ? error.message
                  : "Could not build snapshot",
            });
        },
      );
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [config, key]);

    const prepared = result?.key === key ? result.prepared : null;
  return {
      preview: prepared ? setupPreview(prepared, showUnstudied) : null,
      previewIncludingUnstudied: prepared?.previewIncludingUnstudied,
    error: failure?.key === key ? failure.message : "",
    getPrepared: () => {
      if (!config) throw new Error("Select a deck first");
      return prepare(request, config, key);
    },
    showPrepared: (prepared: PreparedSetup) => {
      if (!request.current || request.current.key === key) {
        request.current = { key, promise: Promise.resolve(prepared) };
      }
      setFailure(null);
      setResult({ key, prepared });
    },
  };
}
