import { memo, useEffect, useRef } from "react";
import { SCENE_HEIGHT, SCENE_WIDTH } from "./layers";

export type SceneImages = Record<string, HTMLImageElement>;
export type ScenePainter = (
  context: CanvasRenderingContext2D,
  seconds: number,
) => void;

type Props = {
  moving: boolean;
  name: string;
  fallback: string;
  assets: Record<string, string>;
  prepare: (images: SceneImages) => ScenePainter;
};

// One clock for every layer, stopped (not reset) by pause or a hidden tab.
export default memo(function SceneCanvas({
  moving,
  name,
  fallback,
  assets,
  prepare,
}: Props) {
  const element = useRef<HTMLCanvasElement>(null);
  const enabled = useRef(moving);
  const sync = useRef<(() => void) | null>(null);

  useEffect(() => {
    const canvas = element.current!;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;
    context.imageSmoothingEnabled = false;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false;
    let frame = 0;
    let time = 0;
    let lastTime = 0;
    let lastDraw = -Infinity;
    let painter: ScenePainter | undefined;
    canvas.dataset.ready = "loading";

    const tick = (now: number) => {
      if (disposed) return;
      if (lastTime) time += Math.min(now - lastTime, 100) / 1000;
      lastTime = now;
      if (now - lastDraw >= 1000 / 24) {
        painter?.(context, time);
        lastDraw = now;
      }
      frame = requestAnimationFrame(tick);
    };
    const syncMotion = () => {
      cancelAnimationFrame(frame);
      const active = enabled.current && !preference.matches && !document.hidden;
      canvas.dataset.motion = active ? "playing" : "paused";
      if (disposed || !painter) return;
      lastTime = 0;
      lastDraw = -Infinity;
      if (!document.hidden) painter(context, time);
      if (active) frame = requestAnimationFrame(tick);
    };
    sync.current = syncMotion;
    const sources = Object.entries(assets).map(([key, url]) => {
      const image = new Image();
      const loaded = new Promise<readonly [string, HTMLImageElement]>(
        (resolve, reject) => {
          image.onload = () => resolve([key, image]);
          image.onerror = () => reject(new Error(`Could not load ${url}`));
        },
      );
      image.src = url;
      return { image, loaded };
    });
    void Promise.all(sources.map((source) => source.loaded))
      .then((entries) => {
        if (disposed) return;
        painter = prepare(Object.fromEntries(entries));
        // Paint before revealing, including when the page initially loads hidden.
        painter(context, time);
        canvas.dataset.ready = "true";
        syncMotion();
      })
      .catch(() => {
        if (!disposed) canvas.dataset.ready = "failed";
      });
    preference.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncMotion);
    return () => {
      disposed = true;
      sync.current = null;
      cancelAnimationFrame(frame);
      for (const source of sources) {
        source.image.onload = null;
        source.image.onerror = null;
      }
      preference.removeEventListener("change", syncMotion);
      document.removeEventListener("visibilitychange", syncMotion);
    };
  }, [assets, prepare]);

  useEffect(() => {
    enabled.current = moving;
    sync.current?.();
  }, [moving]);

  return (
    <div
      className="scenery"
      data-scene={name}
      aria-hidden="true"
      style={{ backgroundImage: `url("${fallback}")` }}
    >
      <canvas
        ref={element}
        className="garden-canvas"
        width={SCENE_WIDTH}
        height={SCENE_HEIGHT}
      />
    </div>
  );
});
