import { useEffect, useState } from "react";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, unknown>;
    }
  }
}

let loader: Promise<unknown> | null = null;

/** Vista previa del modelo 3D tal como lo verán los clientes. */
export function ModelPreview({ src }: { src: string }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    (loader ??= import("@google/model-viewer")).then(() => setReady(true)).catch(() => setFailed(true));
  }, []);
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
