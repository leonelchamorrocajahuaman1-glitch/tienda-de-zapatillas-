import { useEffect, useRef, useState } from "react";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, unknown>;
    }
  }
}

let loader: Promise<unknown> | null = null;

/** El visor ya cargado: permite sacar una imagen del modelo (para su color). */
export interface LoadedModel {
  toDataURL(type?: string): string;
}

/** Vista previa del modelo 3D tal como lo verán los clientes. */
export function ModelPreview({ src, onLoad }: { src: string; onLoad?: (model: LoadedModel) => void }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [node, setNode] = useState<HTMLElement | null>(null);
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;
  useEffect(() => {
    (loader ??= import("@google/model-viewer")).then(() => setReady(true)).catch(() => setFailed(true));
  }, []);
  useEffect(() => {
    if (!node) return;
    const handle = () => onLoadRef.current?.(node as unknown as LoadedModel);
    node.addEventListener("load", handle);
    return () => node.removeEventListener("load", handle);
  }, [node]);
  if (failed) return <div className="alert">No se pudo cargar el visor 3D.</div>;
  if (!ready)
    return (
      <div className="model-preview center" style={{ minHeight: 0 }}>
        <div className="spinner" />
      </div>
    );
  return (
    <div className="model-preview">
      <model-viewer
        ref={setNode}
        src={src}
        alt="Vista previa del modelo 3D"
        loading="eager"
        reveal="auto"
        camera-controls=""
        auto-rotate=""
        touch-action="pan-y"
        shadow-intensity="1"
        environment-image="neutral"
        exposure="1.05"
      />
    </div>
  );
}
