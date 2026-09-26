import type { ModeId } from "./modes";

export default function ModeIllustration({ mode }: { mode: ModeId }) {
  return (
    <svg
      className={`mode-illustration ${mode}`}
      viewBox="0 0 40 40"
      fill="none"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {mode === "story" ? (
        <>
          <path d="M3 31h4v-5h4v-6h5v-6h4v6h5v6h4v5h5v4H3z" fill="#344b70" />
          <path d="M11 26h5v-6h4v5h5v6h4v4H11z" fill="#536c91" />
          <path
            d="M18 35v-4h4v-4h-4v-4h4v-4h4v4h-2v4h3v4h-4v4z"
            fill="#dfbc7b"
          />
          <path d="M28 5h6v3h3v6h-3v3h-6v-3h-3V8h3z" fill="#efca85" />
          <path d="M5 9h4v4H5zM3 11h8v2H3zM11 4h2v2h-2z" fill="#d8a1ba" />
          <path d="M27 9h3v3h-3zM32 13h2v2h-2z" fill="#c58a57" />
        </>
      ) : mode === "study" ? (
        <>
          <path
            d="M19 3h2v6h-2zM14 10h12v3H14zM10 13h20v3H10zM11 16h18v17H11zM9 33h22v3H9z"
            fill="#826344"
          />
          <path d="M14 16h12v16H14z" fill="#efb451" />
          <path d="M17 17h6v14h-6z" fill="#fff0ab" />
          <path d="M19 16h2v16h-2zM13 23h14v2H13z" fill="#b27d3e" />
          <path d="M16 8h8v2h-8zM9 14h22v2H9zM13 35h14v2H13z" fill="#c59b64" />
          <path d="M6 19h2v2H6zM33 26h2v2h-2zM30 7h2v2h-2z" fill="#f0ca74" />
        </>
      ) : (
        <>
          <path
            d="M7 10h26v1H7zM7 20h26v1H7zM7 30h26v1H7zM10 7h1v26h-1zM20 7h1v26h-1zM30 7h1v26h-1z"
            fill="#a89573"
          />
          <path d="M7 4h7v3h3v7h-3v3H7v-3H4V7h3z" fill="#101a28" />
          <path d="M7 5h7v2h2v7h-3v2H7z" fill="#253749" />
          <path d="M7 7h5v3H7z" fill="#647584" />
          <path d="M27 24h7v3h3v7h-3v3h-7v-3h-3v-7h3z" fill="#b9b6a7" />
          <path d="M27 24h7v3h2v6h-4v2h-6v-8h1z" fill="#ece5d2" />
          <path d="M27 26h5v3h-5z" fill="#fff9e8" />
          <path
            d="M30 3h2v5h-2zM28 5h6v1h-6zM6 32h2v5H6zM4 34h6v1H4z"
            fill="#edc16b"
          />
        </>
      )}
    </svg>
  );
}
