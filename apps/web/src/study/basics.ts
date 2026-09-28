/*
 * The beginner lessons, adapted from the Online-Go.com Learning Hub
 * ("Fundamentals": src/views/LearningHub/Sections/Fundamentals in
 * https://github.com/online-go/online-go.com, commit 53dc4b9).
 * Copyright (C) Online-Go.com
 * Copyright (C) 2026 Surround contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * Changes from the original, September 2026: converted from React pages to
 * data; each page's task split out as its goal; the territory and
 * end-of-game pages rewritten for Surround's area scoring (the originals
 * count Japanese-style territory and prisoners); the ko page notes that
 * Surround applies positional superko, and its last page replays White's
 * capture so the rules know the ko was just taken.
 */
import type { Lesson } from "./lessonEngine";

const points = (list: string) => list.split(" ");

export const BASICS: Lesson[] = [
  {
    title: "The Game of Go",
    subtext: "Build territory one stone at a time",
    pages: [
      {
        kind: "puzzle",
        text: "The game starts with an empty board. Two players, Black and White, take turns placing stones on the board. Black starts. You can play a stone on any empty intersection, even the outer ones.",
        goal: "Make a move to continue.",
        correct: "anywhere",
      },
      {
        kind: "puzzle",
        text: "Black has played the first move. Now it is White's turn.",
        goal: "Make a move to continue.",
        toPlay: "white",
        black: "c3",
        correct: "anywhere",
      },
      {
        kind: "puzzle",
        text: "The points next to a stone are called liberties.",
        goal: "Fill one of the liberties of the black stone.",
        toPlay: "white",
        black: "c3",
        marks: { cross: "b3d3c2c4" },
        correct: points("b3 d3 c2 c4"),
      },
      {
        kind: "puzzle",
        text: "A stone is captured when all its liberties are occupied by the opponent's stones.",
        goal: "Capture the black stone by filling its last liberty.",
        toPlay: "white",
        black: "c3",
        white: "b3c2c4",
        marks: { cross: "d3" },
        correct: ["d3"],
      },
      {
        kind: "puzzle",
        text: "Stones of the same color next to each other form a chain.",
        goal: "Fill one of the liberties of the black chain.",
        toPlay: "white",
        black: "c3c4d4",
        marks: { cross: "b3b4c2c5d3d5e4" },
        correct: points("b3 b4 c2 c5 d3 d5 e4"),
      },
      {
        kind: "puzzle",
        text: "The black chain has only one liberty left. This is called 'atari'.",
        goal: "Capture the black chain that is in atari.",
        toPlay: "white",
        black: "c3c4d4",
        white: "b3b4c2c5d3d5",
        marks: { cross: "e4" },
        correct: ["e4"],
      },
    ],
  },
  {
    title: "Self-capture",
    subtext: "Do not capture your own stones",
    pages: [
      {
        kind: "puzzle",
        text: "White to play. Playing at A or B is called 'self-capture' (no liberties for White) and is not allowed. But playing at C is allowed, because it captures the marked stones, creating liberties for White.",
        goal: "Capture the marked black stones.",
        toPlay: "white",
        black: "ceeedfffegehhagbibhc",
        white: "eddefegffg",
        marks: { A: "ia", B: "hb", C: "ef", triangle: "eeff" },
        correct: ["ef"],
      },
      {
        kind: "puzzle",
        text: "White to play. Both players are in atari. Placing a stone where you have no liberties is not allowed, unless you can capture stones.",
        goal: "Capture one or more black stones.",
        toPlay: "white",
        black: "efffcgdgggehfh",
        white: "eefecfdfgfeg",
        correct: ["fg"],
      },
      {
        kind: "puzzle",
        text: "White to play. Both players are in atari. Placing a stone where you have no liberties is not allowed, unless you can capture stones.",
        goal: "Capture one or more black stones.",
        toPlay: "white",
        black: "becfagbgchdhehciei",
        white: "cgdgegahbhfhbifi",
        correct: ["di"],
      },
    ],
  },
  {
    title: "Eyes",
    subtext: "One and two eyes",
    pages: [
      {
        kind: "puzzle",
        text: "Point A is surrounded by white stones; it is called an 'eye'. Black can not play at A (self-capture). Point B is also an eye, but Black can play at B and capture.",
        goal: "Capture the white stones.",
        black: "c1c2c3d3e3f3g3g2g1",
        white: "c7d8e7d6d1d2e2f2f1",
        marks: { A: "d7", B: "e1" },
        correct: ["e1"],
      },
      {
        kind: "puzzle",
        text: "White has a single bigger eye of two points, but the white group is not safe. Black to play.",
        goal: "Capture the white stones by filling the eye point by point.",
        black: "a3b3c3d3d2d1",
        white: "a2b2c2c1",
        correct: ["a1b1a1", "b1a1b1"],
      },
      {
        kind: "puzzle",
        text: "White has two groups of stones. One group has two eyes. The other group has a single big eye. The group with two eyes is safe and can never be captured. Black to play.",
        goal: "Capture a white group.",
        black: "a3b3c3d3e3e2e1g9g8g7g6g5h5j5",
        white: "a2b2c2d2d1b1h9h8h7h6j6",
        correct: ["j8j7j9"],
        wrong: ["j7j8", "j9j8"],
      },
      {
        kind: "puzzle",
        text: "One white group has two 'real' eyes. The other group has a real eye at A and a 'false' eye at B. The false eye is not safe and can be attacked. Black to play.",
        goal: "Capture the white group by attacking the false eye.",
        black: "a3b3c3d3e3e2e1g9g8g7g6h5j5",
        white: "a2b2c2d2d1b1h9h8h7j8j6",
        marks: { A: "j9", B: "j7" },
        correct: ["h6j7j9"],
      },
    ],
  },
  {
    title: "Ko",
    subtext: "The recapture rule",
    pages: [
      {
        kind: "puzzle",
        text: "To prevent endlessly recapturing the same space, there is a special rule called the 'Ko rule' which prevents immediately recapturing the same position. Surround applies it strictly: no move may bring back any earlier board position. Black can capture the marked white stone. White is not allowed to recapture the black stone immediately. White has to play elsewhere first.",
        goal: "Capture the marked stone.",
        black: "e8e6f7",
        white: "c7d8e7d6",
        marks: { triangle: "e7" },
        correct: ["d7"],
      },
      {
        kind: "puzzle",
        text: "",
        goal: "Capture the white group by exploiting the Ko rule.",
        black: "afbfcfcgdhcidi",
        white: "agbgahchbi",
        correct: ["b2d3a1"],
      },
      {
        kind: "puzzle",
        text: "",
        goal: "Connect your black stones.",
        black: "ecedeedfegehfh",
        white: "fdcedefeefgfcgdgfg",
        correct: ["f4c4e4"],
        wrong: ["c4b4", "g3c4"],
      },
      {
        kind: "puzzle",
        text: "",
        goal: "Capture two white stones by exploiting the Ko rule.",
        black: "fcfdgehfggfhgh",
        white: "edfeefgffgeh",
        correct: ["f4e3e5"],
        wrong: ["e3d3", "e5d5", "h5f4", "g6f4"],
      },
      {
        kind: "puzzle",
        text: "White just captured a black stone by playing 1. To move past the ko rule, find a place to play for Black where White must capture. This is called a 'ko threat'. Next, Black can capture White's marked group.",
        goal: "Play a ko threat, then capture the marked group.",
        size: 13,
        bounds: { top: 3, left: 0, bottom: 12, right: 7 },
        // The black stone at a4 and White's capture of it, so the ko is live.
        black: "bgcgchcicjbkalclbmaj",
        white: "bebfagbhaibibj",
        setup: "a3",
        marks: { triangle: "a5b4b5b6", 1: "a3" },
        correct: ["a8a9a4a6a8"],
        // The original also lists an immediate retake at a4 as wrong; here the
        // rules reject it.
        wrong: [
          "a9a8a4a6",
          "c3a8a4a6",
          "b2a8a4a6",
          "c1a8a4a6",
          "a1a8a4a6",
          "c8a8a4a6",
        ],
      },
    ],
  },
  {
    title: "Territory",
    subtext: "Count territory",
    pages: [
      {
        kind: "choice",
        text: "If you have surrounded a part of the board by your stones, that part is called your 'territory'. At the end of the game, each empty point in your territory counts as a point for you, and so does each of your stones on the board. Whoever has the most points wins.",
        goal: "How many points is the territory in the corner?",
        black: "fifhgigghhhgig",
        white: "eiehegfggfhfif",
        options: ["3", "4", "5"],
        answer: "4",
      },
      ...(
        [
          ["didhdgegffgfhfif", "eiehfhfggghihgig", ["6", "7", "8"], "6"],
          [
            "didhdgdfeieffegfgehfif",
            "ehegfifgffgghihgig",
            ["5", "6", "7"],
            "6",
          ],
          ["fifhfggfhhhfif", "eiehegeeffgeheie", ["7", "8", "9"], "8"],
          ["eiehfgeeffgeheie", "fifhgggfhhhfif", ["7", "8", "9"], "7"],
          ["eiehegfggghihgig", "didhdgdfefffgfhfif", ["6", "7", "8"], "7"],
          ["eiehegfggghhhfif", "didhdgdfefffgfheie", ["8", "9", "10"], "9"],
          [
            "bibhbgcgdgegffgfhfigif",
            "cichdhehfggghihgih",
            ["7", "8", "9"],
            "8",
          ],
          [
            "cichcgcfcedeeefegeheie",
            "didhdgdfefffghgfhfif",
            ["12", "14", "15"],
            "14",
          ],
          ["didhdgegfggghgig", "cichcgcfdfefffgfhfif", ["8", "10", "12"], "10"],
        ] as const
      ).map(([black, white, options, answer]) => ({
        kind: "choice" as const,
        text: "",
        goal: "How many points is the territory in the corner?",
        black,
        white,
        options: [...options],
        answer,
      })),
      {
        kind: "choice",
        text: "Opponent's stones in your territory are lost if they do not have two eyes. These lost stones are called 'dead'. At the end of the game, dead stones are taken off the board, and the points they stood on count as your territory.",
        goal: "How many points is the territory in the corner?",
        black: "fifhfggggfhhhfif",
        white: "eiehegeeffgehgheie",
        options: ["6", "7", "8"],
        answer: "7",
      },
      {
        kind: "choice",
        text: "",
        goal: "How many points is the territory in the corner?",
        black: "cichcgcfdfeheffhffgfhfif",
        white: "didhdgegfggghgig",
        options: ["8", "10", "12"],
        answer: "10",
      },
    ],
  },
  {
    title: "End of the Game",
    subtext: "Both players pass",
    pages: [
      {
        kind: "action",
        text: "You are not obliged to place a stone on the board when it is your turn. You can instead pass. When they don't think there are any more good moves to make, to end the game both players pass their turns. This game is finished.",
        goal: "Click Pass to end it.",
        black: "fafbgbhbgdhdcedeheiebfdfefgfhfagcgegfggg",
        white: "eahaebibbcccecfcgchcicadcdddfdidaebeeefegeafff",
        button: "Pass",
      },
      {
        kind: "removal",
        text: "After both players have passed, you enter a 'stone removal phase', where you can remove obviously dead stones from play.",
        goal: "Remove the dead black stones by clicking them.",
        black: "fafbgbhbgdhdcedeheiebfdfefgfhfagcgegfggg",
        white: "eahaebibbcccecfcgchcicadcdddfdidaebeeefegeafff",
        dead: "fafbgbhb",
      },
      {
        kind: "action",
        text: "After removing the dead stones, each player counts their area: their stones on the board plus the empty points they surround. Black has 16 stones and 24 points of territory, for 40. White has 23 stones and 18 points of territory, for 41. White also receives a few points of komi for playing second, so White has won the game.",
        goal: "Click Finish to end the game.",
        black: "gdhdcedeheiebfdfefgfhfagcgegfggg",
        white: "eahaebibbcccecfcgchcicadcdddfdidaebeeefegeafff",
        button: "Finish",
      },
    ],
  },
  {
    title: "The Board",
    subtext: "Corners, sides and middle",
    pages: [
      {
        kind: "puzzle",
        text: "You can play anywhere, but a good general strategy is to focus on the corners first, then sides, then the middle.",
        goal: "Play a stone in the upper right hand corner.",
        correct: points("f9 g9 h9 j9 f8 g8 h8 j8 f7 g7 h7 j7 f6 g6 h6 j6"),
      },
      {
        kind: "puzzle",
        text: "Go can be played on any size board, but the most common are 9x9 (which you should start on), 13x13, and the most popular, 19x19.",
        goal: "Play on the right side of the board (not in a corner).",
        size: 13,
        correct: points(
          "k9 l9 m9 n9 k8 l8 m8 n8 k7 l7 m7 n7 k6 l6 m6 n6 k5 l5 m5 n5",
        ),
      },
      {
        kind: "puzzle",
        text: "You will note that there are several dots on the board. These are called 'star points'. They are not particularly special; they are just useful for orienting yourself on the board.",
        goal: "Play on a star point.",
        size: 19,
        correct: points("d16 k16 q16 d10 k10 q10 d4 k4 q4"),
      },
    ],
  },
];
