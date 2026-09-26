import { memo, useEffect, useRef } from "react";
import { createWaterfall } from "./waterfall";
import {
  ASSET_URLS,
  createCanvas,
  drawBranch,
  prepareLayers,
  SCENE_HEIGHT as HEIGHT,
  SCENE_WIDTH as WIDTH,
  type SceneImages,
} from "./layers";

const FRAME_MS = 1000 / 24;
type Patch = {
  x: number;
  y: number;
  width: number;
  height: number;
  phase: number;
};

function polygon(points: readonly (readonly [number, number])[]) {
  const path = new Path2D();
  points.forEach(([x, y], index) =>
    index ? path.lineTo(x, y) : path.moveTo(x, y),
  );
  path.closePath();
  return path;
}

function randomGenerator(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
}

function glowTexture(color: string) {
  const texture = createCanvas(128, 128);
  const context = texture.getContext("2d")!;
  const gradient = context.createRadialGradient(64, 64, 2, 64, 64, 64);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, "transparent");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  return texture;
}

function warmLightMask(image: HTMLImageElement, patch: Patch) {
  const texture = createCanvas(patch.width, patch.height);
  const context = texture.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(
    image,
    patch.x,
    patch.y,
    patch.width,
    patch.height,
    0,
    0,
    patch.width,
    patch.height,
  );
  const pixels = context.getImageData(0, 0, patch.width, patch.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const [red, green, blue] = pixels.data.subarray(i, i + 3);
    // Only painted amber pixels dim, keeping dark frames and roofs intact.
    pixels.data[i + 3] =
      red > 65 && red > blue * 1.7 && green > blue * 1.12 ? 255 : 0;
    pixels.data[i] = 13;
    pixels.data[i + 1] = 23;
    pixels.data[i + 2] = 36;
  }
  context.putImageData(pixels, 0, 0);
  return texture;
}

export default memo(function GardenScene({ moving }: { moving: boolean }) {
  const element = useRef<HTMLCanvasElement>(null);
  const sceneTime = useRef(0);
  const motionEnabled = useRef(moving);
  const syncMotionRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const output = element.current!;
    const context = output.getContext("2d", { alpha: false });
    if (!context) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false;
    let frame = 0;
    let previousTime = 0;
    let previousDraw = -Infinity;
    let draw: ((time: number) => void) | undefined;

    const tick = (now: number) => {
      if (disposed) return;
      if (previousTime)
        sceneTime.current += Math.min(now - previousTime, 100) / 1000;
      previousTime = now;
      if (now - previousDraw >= FRAME_MS) {
        draw?.(sceneTime.current);
        previousDraw = now;
      }
      frame = requestAnimationFrame(tick);
    };

    const syncMotion = () => {
      cancelAnimationFrame(frame);
      const active =
        motionEnabled.current && !reducedMotion.matches && !document.hidden;
      output.dataset.motion = active ? "playing" : "paused";
      if (!draw || disposed) return;
      previousTime = 0;
      previousDraw = -Infinity;
      if (!document.hidden) draw(sceneTime.current);
      if (active) frame = requestAnimationFrame(tick);
    };
    syncMotionRef.current = syncMotion;

    const sources = Object.entries(ASSET_URLS).map(([key, url]) => {
      const image = new Image();
      const loaded = new Promise<readonly [string, HTMLImageElement]>(
        (resolve, reject) => {
          image.onload = () => resolve([key, image]);
          image.onerror = () =>
            reject(new Error("Could not load garden layer: " + url));
        },
      );
      image.src = url;
      return { image, loaded };
    });

    void Promise.all(sources.map((source) => source.loaded))
      .then((entries) => {
        if (disposed) return;
        const images = Object.fromEntries(entries) as SceneImages;
        const layers = prepareLayers(images);
        const drawWaterfall = createWaterfall(images.plate);
        context.imageSmoothingEnabled = false;
        const moonGlow = glowTexture("#b5d6ff");
        const warmGlow = glowTexture("#fcb457");
        const pond = polygon([
          [439, 564],
          [811, 560],
          [987, 556],
          [1110, 553],
          [1253, 557],
          [1321, 580],
          [1320, 682],
          [985, 692],
          [887, 665],
          [737, 653],
          [638, 620],
          [550, 611],
          [445, 589],
        ]);
        const windowTextures = [
          { x: 1277, y: 318, width: 42, height: 22, phase: 0.1 },
          { x: 1319, y: 318, width: 42, height: 22, phase: 2.3 },
          { x: 1263, y: 366, width: 58, height: 22, phase: 4.1 },
          { x: 1321, y: 366, width: 55, height: 22, phase: 1.5 },
        ].map((patch) => ({
          ...patch,
          texture: warmLightMask(images.plate, patch),
        }));
        const rightLanterns = [
          // The stone garden lantern and the paper lantern at the room's edge.
          {
            x: 1245,
            y: 470,
            width: 40,
            height: 34,
            phase: 0.5,
            centerX: 1262,
            centerY: 485,
            halo: 130,
          },
          {
            x: 1568,
            y: 582,
            width: 72,
            height: 76,
            phase: 1.3,
            centerX: 1610,
            centerY: 607,
            halo: 175,
          },
        ].map((light) => ({
          ...light,
          texture: warmLightMask(images.plate, light),
        }));
        const random = randomGenerator(271);
        const reflections = Array.from({ length: 86 }, () => ({
          x: 745 + random() * 550,
          y: 561 + random() * 128,
          width: 3 + random() * 17,
          phase: random() * Math.PI * 2,
          speed: 0.7 + random() * 0.6,
        }));
        const clouds = [
          { start: 360, y: 129, width: 850, speed: 1.8, opacity: 0.28 },
          { start: 980, y: 160, width: 650, speed: 3.1, opacity: 0.43 },
          { start: 650, y: 200, width: 580, speed: 4.2, opacity: 0.35 },
        ];

        draw = (time: number) => {
          context.globalAlpha = 1;
          context.globalCompositeOperation = "source-over";
          context.drawImage(images.plate, 0, 0, WIDTH, HEIGHT);

          const moonVeil = Math.pow((1 + Math.sin(time * 0.038 - 1.4)) / 2, 6);
          context.globalCompositeOperation = "screen";
          context.globalAlpha =
            (0.13 + Math.sin(time * 0.24) * 0.035) * (1 - moonVeil * 0.6);
          context.drawImage(moonGlow, 1017, 73, 230, 230);
          context.globalCompositeOperation = "source-over";

          // Alpha cloud banks replace the removed painted clouds. Wrapping happens
          // beyond the scene edges; each bank travels at a different depth/speed.
          for (const cloud of clouds) {
            const route = WIDTH + cloud.width;
            const x =
              ((cloud.start + cloud.width + time * cloud.speed) % route) -
              cloud.width;
            context.globalAlpha = cloud.opacity;
            context.drawImage(
              layers.cloud,
              Math.round(x),
              cloud.y,
              cloud.width,
              (cloud.width * 115) / 1004,
            );
          }
          context.globalAlpha = 1;
          // This matte puts the landscape, pagoda and room in front of the clouds.
          context.drawImage(layers.foreground, 0, 0);

          // Keep the original lake shimmer: only water scanlines and glints move.
          context.save();
          context.clip(pond);
          for (let y = 553; y < 695; y += 3) {
            const dx = Math.round(
              Math.sin(y * 0.17 + time * 0.92) * 1.7 +
                Math.sin(y * 0.07 - time * 0.48),
            );
            context.drawImage(
              images.water,
              430,
              y,
              900,
              3,
              430 + dx,
              y,
              900,
              3,
            );
          }
          context.globalCompositeOperation = "screen";
          context.fillStyle = "#a9c8e0";
          for (const glint of reflections) {
            const brightness = Math.pow(
              (1 + Math.sin(time * glint.speed + glint.phase)) / 2,
              3,
            );
            context.globalAlpha = brightness * 0.29 * (1 - moonVeil * 0.4);
            context.fillRect(
              Math.round(glint.x + Math.sin(time * 0.45 + glint.phase) * 5),
              Math.round(glint.y),
              Math.round(glint.width * (0.5 + brightness * 0.5)),
              1,
            );
          }
          context.restore();

          // Draw after lake scanlines so they don't erase the impact ripples.
          drawWaterfall(context, time);

          for (const light of windowTextures) {
            context.globalAlpha =
              0.2 + (1 + Math.sin(time * 0.3 + light.phase)) * 0.28;
            context.drawImage(light.texture, light.x, light.y);
          }
          // One ten-second breathing cycle changes the actual illuminated panes
          // and their spill together, rather than flickering a glow over the lamp.
          for (const light of rightLanterns) {
            const pulse = (1 + Math.sin(time * 0.62 + light.phase)) / 2;
            context.globalAlpha = 0.11 + (1 - pulse) * 0.33;
            context.drawImage(light.texture, light.x, light.y);
            context.globalCompositeOperation = "screen";
            context.globalAlpha = 0.045 + pulse * 0.17;
            context.drawImage(
              warmGlow,
              light.centerX - light.halo / 2,
              light.centerY - light.halo / 2,
              light.halo,
              light.halo,
            );
            context.globalCompositeOperation = "source-over";
          }
          context.globalAlpha = 1;
          // Actual transparent branch cutouts bend around their attachment points.
          for (const branch of layers.branches)
            drawBranch(context, branch, time);

          context.globalCompositeOperation = "screen";
          for (const [x, y, size, phase] of [
            [125, 631, 275, 0.8],
            [1126, 426, 46, 0.5],
          ]) {
            context.globalAlpha =
              0.12 +
              Math.sin(time * 0.7 + phase) * 0.035 +
              Math.sin(time * 1.7 + phase) * 0.012;
            context.drawImage(warmGlow, x - size / 2, y - size / 2, size, size);
          }
          context.globalAlpha = 1;
          context.globalCompositeOperation = "source-over";
        };
        output.dataset.ready = "true";
        syncMotion();
      })
      .catch(() => {
        if (!disposed) output.dataset.ready = "failed";
      });

    reducedMotion.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncMotion);
    return () => {
      disposed = true;
      syncMotionRef.current = null;
      cancelAnimationFrame(frame);
      for (const source of sources) {
        source.image.onload = null;
        source.image.onerror = null;
      }
      reducedMotion.removeEventListener("change", syncMotion);
      document.removeEventListener("visibilitychange", syncMotion);
    };
  }, []);

  // Toggling motion doesn't reload textures or rebuild the branch meshes.
  useEffect(() => {
    motionEnabled.current = moving;
    syncMotionRef.current?.();
  }, [moving]);

  return (
    <div className="scenery" aria-hidden="true">
      <canvas
        ref={element}
        className="garden-canvas"
        width={WIDTH}
        height={HEIGHT}
      />
    </div>
  );
});
