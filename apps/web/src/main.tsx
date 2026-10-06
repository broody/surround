import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/pixelify-sans/latin-400.css";
import "@fontsource/pixelify-sans/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import App from "./App";
import { WalletProvider } from "./wallet/WalletProvider";
import { RatedProvider } from "./rated/RatedProvider";
import "./styles.css";
import "./landing/landing.css";
import "./landing/features.css";
import "./components/ui/ui.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WalletProvider>
      <RatedProvider>
        <App />
      </RatedProvider>
    </WalletProvider>
  </React.StrictMode>,
);
