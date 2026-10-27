import { forwardRef, useCallback, useState, type Ref } from "react";
import type { SpinFrame } from "@tienda/shared";
import { ModelViewer } from "./ModelViewer";
import { Spin360, type SpinHandle } from "./Spin360";

interface Props {
  name: string;
  modelUrl: string | null;
  images: { url: string; alt?: string }[];
  interactive?: boolean;
  autoRotate?: boolean;
  cameraOrbit?: string;
  className?: string;
  /** fotogramas 360° reales: se usan si no hay modelo 3D */
  spin?: SpinFrame[];
  spinRef?: Ref<SpinHandle>;
}

/**
 * Muestra el modelo 3D real del producto si existe. Si no hay modelo (o falla
 * al cargar) usa su vista 360° con fotos reales y, si no, la foto del producto; si tampoco hay foto, una silueta
 * claramente rotulada como "sin modelo 3D". Nunca inventa un modelo.
 */
export const ProductVisual = forwardRef<HTMLElement, Props>(function ProductVisual(
  { name, modelUrl, images, interactive, autoRotate, cameraOrbit, className, spin, spinRef },
  ref,
) {
  const [failed, setFailed] = useState(false);
  const onError = useCallback(() => setFailed(true), []);
  const poster = images[0]?.url;

  if (modelUrl && !failed) {
    return (
      <ModelViewer
        ref={ref}
        src={modelUrl}
        alt={`Modelo 3D de ${name}`}
        poster={poster}
        interactive={interactive}
        autoRotate={autoRotate}
        cameraOrbit={cameraOrbit}
        className={`visual visual--model ${className ?? ""}`}
        onError={onError}
      />
    );
  }
  if (spin && spin.length > 0) {
    return (
      <div className={`visual visual--spin ${className ?? ""}`}>
        <Spin360 ref={spinRef} frames={spin} alt={`Vista 360° de ${name}`} />
      </div>
    );
  }
  if (poster) {
    return (
      <div className={`visual visual--image ${className ?? ""}`}>
        <img src={poster} alt={images[0]?.alt || name} draggable={false} />
      </div>
    );
  }
  return <NoModel name={name} className={className} />;
});

export function NoModel({ name, className }: { name: string; className?: string }) {
  return (
    <div className={`visual visual--empty ${className ?? ""}`} role="img" aria-label={`${name}: sin imagen ni modelo 3D`}>
      <svg viewBox="0 0 200 90" aria-hidden>
        <path
          d="M8 70c22 0 38-8 54-26l14 8c14 8 34 12 60 12 22 0 46 4 58 12v8H8z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />
      </svg>
      <span className="eyebrow">Modelo 3D no disponible</span>
    </div>
  );
}
