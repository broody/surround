/** The most handicap a `size` board takes: 9 on 13×13 and 19×19, 5 on 9×9. */
export declare const maxHandicap: (size: number) => number;
/** The komi of a handicap game, in half-points. */
export declare const HANDICAP_KOMI_HALF: number;
/** Black's handicap stones on a `size` board, as points (row × size + column), in fixed placement; none under 2. */
export declare function handicapPoints(size: number, stones: number): number[];
