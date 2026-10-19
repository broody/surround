import { Suspense, lazy, useEffect, useState } from "react";
import { LinkButton } from "./components/ui";
import BrandLogo from "./components/BrandLogo";
import StudyPage from "./study/StudyPage";
import LobbyPage from "./lobby/LobbyPage";
import CharacterGallery from "./lobby/CharacterGallery";
import GardenScene from "./scene/GardenScene";
import WinterScene from "./scene/WinterScene";
import SunlitScene from "./scene/SunlitScene";
import { nextInRotation } from "./rotation";
import LandingPage from "./landing/LandingPage";
import { COMING_SOON, DOCS_URL } from "./launch";

// Games load the protocol SDK: their own chunk.
const RatedMatchPage = lazy(() => import("./rated/RatedMatchPage"));

const MOTE_COUNT = 32;
/** The scenes behind the landing page: each page load opens on the next, in turn. */
const SCENES = { moonlit: GardenScene, sunlit: SunlitScene, winter: WinterScene };
type SceneId = keyof typeof SCENES;
const LOAD_SCENES: SceneId[] = ["moonlit", "sunlit", "winter"];
const LOAD_SCENE =
  LOAD_SCENES[nextInRotation("surround:scene", LOAD_SCENES.length)];

export default function App() {
  const [route, setRoute] = useState(() => window.location.hash);
  useEffect(() => {
    const navigate = () => setRoute(window.location.hash);
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);
  // Until play opens, every route shows the landing page.
  if (!COMING_SOON) {
    if (route === "#study") return <StudyPage />;
    if (route === "#characters") return <CharacterGallery />;
    if (route.startsWith("#lobby")) return <LobbyPage />;
    const game = /^#rated\/(0x[0-9a-f]+)$/i.exec(route);
    if (game)
      return (
        <Suspense fallback={null}>
          <RatedMatchPage key={game[1]} digest={game[1]} />
        </Suspense>
      );
  }
  return <SurroundPreview />;
}

/** The landing page, over a garden scene that moves unless the reader prefers reduced motion. */
function SurroundPreview() {
  const [sceneMotion, setSceneMotion] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [scene] = useState<SceneId>(LOAD_SCENE);
  const Scene = SCENES[scene];

  useEffect(() => {
    document.title = "Surround — A quiet mind. An open board.";
  }, []);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => setSceneMotion(!preference.matches);
    preference.addEventListener("change", changed);
    return () => preference.removeEventListener("change", changed);
  }, []);

  return (
    <div
      id="home"
      className="app-shell landing-shell"
      data-scene-motion={sceneMotion ? "playing" : "paused"}
      data-scene={scene}
    >
      <a
        href="#main-content"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Skip to content
      </a>
      <Scene moving={sceneMotion} />
      {scene === "moonlit" && (
        <div className="fireflies" aria-hidden="true">
          {Array.from({ length: MOTE_COUNT }, (_, i) => (
            <i
              key={i}
              style={{
                left: `${5 + (i * 90) / (MOTE_COUNT - 1)}%`,
                top: `${38 + ((i * 19) % 53)}%`,
                animationDelay: `${i * -2.17}s`,
                animationDuration: `${9 + (i % 5) * 1.1}s`,
              }}
            />
          ))}
        </div>
      )}
      <header className="site-header landing-header">
        <a className="brand" href="#home" aria-label="Surround home">
          <BrandLogo />
        </a>
        <div className="header-actions">
          <LinkButton variant="text" href={DOCS_URL}>
            Docs
          </LinkButton>
        </div>
      </header>
      <LandingPage hidden={false} />
    </div>
  );
}
