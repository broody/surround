import { forwardRef, useEffect, useState } from "react";
import { Button, Dialog, Input } from "../components/ui";

/**
 * Change your portrait: upload a photo, and it's drawn in the Dojo's pixel
 * style, like the regulars', for you to keep or try again.
 *
 * MOCKUP: no service draws portraits yet. `draw` stands in for it by
 * pixelating the photo in the browser; the real one sends the photo to be
 * drawn by AI in the cast's style and returns the portrait.
 */
const PortraitDialog = forwardRef<HTMLDialogElement, { onClose(): void; onUse(portrait: string): void }>(
  function PortraitDialog({ onClose, onUse }, ref) {
    const [photo, setPhoto] = useState<string | null>(null);
    const [drawn, setDrawn] = useState<string | null>(null);
    const [error, setError] = useState<string>();
    const step = !photo ? "choose" : !drawn ? "drawing" : "review";

    useEffect(() => {
      if (!photo) return;
      let live = true;
      draw(photo).then(
        (portrait) => live && setDrawn(portrait),
        () => live && (setError("That photo couldn't be read. Try another."), setPhoto(null)),
      );
      return () => {
        live = false;
      };
    }, [photo]);

    const reset = () => {
      setPhoto(null);
      setDrawn(null);
      setError(undefined);
    };
    const close = () => {
      reset();
      onClose();
    };

    return (
      <Dialog ref={ref} onCloseRequest={close} aria-labelledby="portrait-title">
        <span className="eyebrow">YOUR PORTRAIT</span>
        <h2 id="portrait-title">
          {step === "choose" ? "Step into the Dojo." : step === "drawing" ? "Drawing your portrait…" : "Here you are."}
        </h2>
        {step === "choose" && (
          <>
            <p>
              Upload a photo of yourself. We draw your portrait from it in the Dojo&rsquo;s pixel style, like the
              regulars&rsquo;, and that portrait is what other players see.
            </p>
            <label htmlFor="portrait-photo">A photo (JPEG or PNG)</label>
            <Input
              id="portrait-photo"
              type="file"
              accept="image/png,image/jpeg"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) setPhoto(URL.createObjectURL(file));
              }}
            />
          </>
        )}
        {step === "drawing" && (
          <div className="portrait-compare">
            <figure>
              <img src={photo!} alt="Your photo" />
              <figcaption>Your photo</figcaption>
            </figure>
            <p className="live-muted" role="status">
              This takes a few seconds.
            </p>
          </div>
        )}
        {step === "review" && (
          <div className="portrait-compare">
            <figure>
              <img src={photo!} alt="Your photo" />
              <figcaption>Your photo</figcaption>
            </figure>
            <figure>
              <img className="portrait-pixels" src={drawn!} alt="Your portrait" />
              <figcaption>Your portrait</figcaption>
            </figure>
          </div>
        )}
        {error && (
          <p className="wallet-warning" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          {step === "review" && (
            <>
              <Button variant="primary" onClick={() => (onUse(drawn!), close())}>
                Use this portrait
              </Button>
              <Button onClick={reset}>Try another photo</Button>
            </>
          )}
          <Button variant="text" onClick={close}>
            Cancel
          </Button>
        </div>
      </Dialog>
    );
  },
);
export default PortraitDialog;

/** MOCKUP: the photo, center-cropped and pixelated to 40 × 40, after a pause like the real drawing's. */
async function draw(photo: string): Promise<string> {
  const image = new Image();
  image.src = photo;
  await image.decode();
  await new Promise((resolve) => setTimeout(resolve, 1800));
  const side = Math.min(image.width, image.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 40;
  canvas.getContext("2d")!.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, 40, 40);
  return canvas.toDataURL("image/png");
}
