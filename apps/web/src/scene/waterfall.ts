// Registered to the waterfall in the 1672×941 clean plate. The mask follows
// only the falling curtain; rocks, trees and the lip stay stationary.
export function createWaterfall(image: HTMLImageElement) {
  const curtain = new Path2D();
  const outline = [
    [500, 447],
    [515, 448],
    [537, 449],
    [551, 454],
    [558, 473],
    [562, 499],
    [565, 526],
    [568, 541],
    [558, 549],
    [539, 550],
    [523, 543],
    [522, 516],
    [519, 487],
    [513, 465],
    [507, 453],
  ];
  outline.forEach(([x, y], i) =>
    i ? curtain.lineTo(x, y) : curtain.moveTo(x, y),
  );
  curtain.closePath();

  return (context: CanvasRenderingContext2D, time: number) => {
    context.save();
    context.clip(curtain);
    // A downward-travelling displacement moves the painted water texture,
    // rather than sliding a rectangular piece of the surrounding scenery.
    context.globalAlpha = 0.88;
    for (let y = 447; y < 550; y += 2) {
      const depth = (y - 447) / 103;
      const envelope = Math.sin(depth * Math.PI);
      const offset = Math.sin(y * 0.24 - time * 5.2) * 4 * envelope;
      const sampleY = Math.max(447, Math.min(548, Math.round(y + offset)));
      const dx = Math.round(Math.sin(y * 0.12 - time * 2.3) * envelope);
      context.drawImage(image, 498, sampleY, 73, 2, 498 + dx, y, 73, 2);
    }

    // Fine interrupted highlights follow the bend over the lip, then fall.
    context.globalCompositeOperation = "screen";
    context.fillStyle = "#c2e3f5";
    for (let i = 0; i < 18; i++) {
      const lane = i % 5;
      const progress = (time * (0.27 + lane * 0.028) + i * 0.173) % 1;
      const bend = 1 - Math.exp(-progress * 5);
      const x = 503 + lane * 10 + bend * (26 - lane * 3.5);
      context.globalAlpha = Math.sin(progress * Math.PI) * 0.25;
      context.fillRect(
        Math.round(x),
        Math.round(448 + progress * 99),
        1 + (i % 2),
        3 + (i % 6),
      );
    }
    context.restore();

    context.save();
    context.globalCompositeOperation = "screen";
    context.fillStyle = "#b6d9e9";
    // Small ballistic droplets and brief foam glints stay at the impact point.
    for (let i = 0; i < 14; i++) {
      const progress = (time * (0.55 + (i % 3) * 0.09) + i * 0.193) % 1;
      const origin = 531 + ((i * 7) % 46);
      const spread = (i % 2 ? 1 : -1) * (5 + (i % 9));
      const x = origin + spread * progress;
      const y =
        546 + (i % 3) * 2 - Math.sin(progress * Math.PI) * (4 + (i % 7));
      context.globalAlpha = Math.sin(progress * Math.PI) * 0.32;
      context.fillRect(Math.round(x), Math.round(y), i % 3 ? 1 : 2, 2);
    }
    // Low, stepped rings spread into the pond and fade before wrapping.
    for (let i = 0; i < 3; i++) {
      const progress = (time * 0.25 + i / 3) % 1;
      const radius = 5 + progress * 25;
      const y = Math.round(553 + progress * 7);
      context.globalAlpha = Math.sin(progress * Math.PI) * 0.17;
      context.fillRect(
        Math.round(551 - radius),
        y,
        Math.round(radius * 0.6),
        1,
      );
      context.fillRect(
        Math.round(551 + radius * 0.4),
        y,
        Math.round(radius * 0.6),
        1,
      );
      context.fillRect(
        Math.round(551 - radius * 0.55),
        y + 2,
        Math.round(radius * 1.1),
        1,
      );
    }
    context.restore();
  };
}
