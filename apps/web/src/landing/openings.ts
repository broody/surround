import { emptyPosition, play, SIZE, type Position } from "../game/rules.ts";

export const OPENING_MOVES = 30;

/**
 * Openings for the hero board: the first OPENING_MOVES moves of ten even
 * 19×19 games between dan players, from u-go.net's public KGS archive
 * (https://dl.u-go.net/gamerecords/KGS-2019_04-19-1255-.zip, the same archive
 * as tests/fixtures/sgf). Games between two humans, 4d and up, at komi 6.5 or
 * 7.5, with no handicap or setup stones; each `game` names its archive member,
 * kgs-19-2019-04-new/<game>.sgf. Moves are SGF points, column letter first.
 */
export const OPENINGS = [
  {
    game: "2019-04-03-23",
    black: "Mushishi",
    blackRank: "6d",
    white: "yuki",
    whiteRank: "6d",
    moves: "qddppqddfccflcpoqmqqqpppqoqnpnrnrqqrrooqrmonpmfqmgpdqccnfedb",
  },
  {
    game: "2019-04-08-3",
    black: "Welvang",
    blackRank: "6d",
    white: "ben0",
    whiteRank: "6d",
    moves: "qddpdcppcnfqceocmdclodpcqcmcncnbndlcjcpdpeqbrbpbqfreqeldjelf",
  },
  {
    game: "2019-04-09-12",
    black: "ftyfth",
    blackRank: "6d",
    white: "Dom",
    whiteRank: "6d",
    moves: "pdqpcdecdfdpcqdqcpcnbnbmcodndoeoeperfpfogoencrgpfqgqfrgrfsho",
  },
  {
    game: "2019-04-12-48",
    black: "pheeky2538",
    blackRank: "4d",
    white: "Jupiter15k",
    whiteRank: "7d",
    moves: "pdddqpdqcofpoqqoqkrpqqooqnropnpomponolplpkomnlqlccdccdcfcede",
  },
  {
    game: "2019-04-14-31",
    black: "KoreaInsei",
    blackRank: "8d",
    white: "gobb",
    whiteRank: "5d",
    moves: "pdddqpdpnqqjcccddcecebfcfbgcgbhcfqcndqcqcreqdreperbqfpgrfrhq",
  },
  {
    game: "2019-04-15-1",
    black: "meanman",
    blackRank: "7d",
    white: "Fredda",
    whiteRank: "6d",
    moves: "qdddcppqqoplfqocpnpeqepfqgpgqhphpiqiqfqjoinhnimhminllhlimkki",
  },
  {
    game: "2019-04-16-4",
    black: "agcStupGod",
    blackRank: "9d",
    white: "stakeout",
    whiteRank: "9d",
    moves: "qddppqdcndqonplcbepdpeqcpcodocoeqenemdncqbnbmemflfrcpbngrblg",
  },
  {
    game: "2019-04-17-41",
    black: "Seraphim",
    blackRank: "7d",
    white: "SonGoku",
    whiteRank: "9d",
    moves: "qcdpopqqcdponnmpoopnqmpmplolpknmlooridpfokmmphpdpcndncmcocme",
  },
  {
    game: "2019-04-23-27",
    black: "Snicker",
    blackRank: "6d",
    white: "Darkness",
    whiteRank: "7d",
    moves: "cpppqcdcdececfcddffddjepeqfqdqfpdnelecedddccfcgdhbichchdibjc",
  },
  {
    game: "2019-04-24-27",
    black: "cr42y570n3",
    blackRank: "7d",
    white: "zxcs",
    whiteRank: "7d",
    moves: "pddppqddccdccddebfqoqmoppppoooonnopmplolpkokpjojpinqlpmonnmp",
  },
] as const;

export type Opening = (typeof OPENINGS)[number];

const point = (sgf: string) =>
  (sgf.charCodeAt(1) - 97) * SIZE + sgf.charCodeAt(0) - 97;

export function openingPosition(opening: Opening): Position {
  let position = emptyPosition();
  for (let i = 0; i < opening.moves.length; i += 2)
    position = play(position, point(opening.moves.slice(i, i + 2)));
  return position;
}

export const openingDescription = (opening: Opening) =>
  `The first ${OPENING_MOVES} moves of a 2019 KGS game: ${opening.black} (${opening.blackRank}) as Black against ${opening.white} (${opening.whiteRank}) as White.`;
