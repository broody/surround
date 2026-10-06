import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { LinkButton, Panel, Switch } from "../components/ui";
import { CHARACTERS, levelName } from "../../../../shared/lobby.ts";
import { EMOTIONS, characterPortrait } from "./characterArt";
import { LobbyHeader } from "./LobbyPage";
import "./lobby.css";
import "./characterGallery.css";

export default function CharacterGallery() {
  const [small, setSmall] = useState(false);
  useEffect(() => { document.title = "Surround — Character emotions"; }, []);
  return (
    <div className="live-page">
      <LobbyHeader />
      <main className="live-main character-gallery" id="main-content">
        <LinkButton variant="text" href="#lobby"><ArrowLeft size={15} /> The Dojo</LinkButton>
        <div className="lobby-intro">
          <div><p className="live-eyebrow">MEET THE CAST</p><h1>Every face tells a story.</h1>
            <p>{CHARACTERS.length} characters, beginner to pro. {EMOTIONS.length} expressions each.</p></div>
        </div>
        <div className="character-gallery-filters">
          <Switch checked={small} onCheckedChange={setSmall}>Small portraits · 88px</Switch>
        </div>
        <div className={`character-gallery-list${small ? " character-gallery-small" : ""}`}>
          {CHARACTERS.map(character => (
            <Panel as="article" className="character-gallery-row" key={character.id}>
              <header><h2>{character.name}</h2><p className="live-muted">{levelName(character.rank)} · {character.style}</p></header>
              <div className="character-gallery-states">
                <figure><img src={character.portrait} alt={`${character.name}, original portrait`} width="150" height="150" loading="lazy" /><figcaption>Original</figcaption></figure>
                {EMOTIONS.map(emotion => <figure key={emotion}>
                  <a href={characterPortrait(character, emotion)} target="_blank" rel="noreferrer" aria-label={`Open ${character.name}, ${emotion} portrait`}>
                    <img src={characterPortrait(character, emotion)} alt={`${character.name}, ${emotion}`} width="150" height="150" loading="lazy" />
                  </a><figcaption>{emotion}</figcaption>
                </figure>)}
              </div>
            </Panel>
          ))}
        </div>
      </main>
    </div>
  );
}
