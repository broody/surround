"""Extract OGS's ranked games into numpy arrays, with the filters OGS's own
analysis applies (goratings analysis/util/OGSGameData.py and SkipLogic.py).

    python3 prep.py path/to/ogs-data.db data/games.npz
"""
import sqlite3
import sys

import numpy as np

RULES = {"aga": 0, "chinese": 1, "ing": 2, "japanese": 3, "korean": 4, "nz": 5}
ALIAS = {"Japanese": "japanese", "age": "aga", "ing sst": "ing", "ogs": "japanese"}


def handicap_rank_difference(handicap, size, komi, rules):
    """Black's head start in OGS ranks; goratings analysis/util/RatingMath.py."""
    extra = handicap - 1 if handicap > 1 else 0
    territory = rules in ("japanese", "korean")
    area_bonus = 0 if territory else 1
    bonus = 0 if territory else handicap if rules == "chinese" else extra if rules == "aga" else 0
    perfect = 6 + area_bonus
    stone = 12 + area_bonus
    head_start = perfect - (komi + bonus) + stone * extra
    return head_start * {9: 6, 13: 3}.get(size, 1) / 12


def main(db, out):
    rows = sqlite3.connect(db).execute(
        "SELECT size, handicap, komi, black_id, white_id, time_per_move, timeout, winner_id, ended, rules"
        " FROM game_records g LEFT JOIN players bp ON black_id = bp.id LEFT JOIN players wp ON white_id = wp.id"
        " WHERE (bp.is_bot = 0 OR bp.id > 50000) AND (wp.is_bot = 0 OR wp.id > 50000)"
        " AND black_id != 82957 AND white_id != 82957"
        " AND (bp.is_bot != 1 OR timeout = 0) AND (wp.is_bot != 1 OR timeout = 0)"
        " ORDER BY ended"
    ).fetchall()
    n = len(rows)
    cols = {k: np.empty(n, t) for k, t in [
        ("size", np.int8), ("hcap", np.int8), ("black", np.int32), ("white", np.int32), ("speed", np.int8),
        ("timeout", np.bool_), ("result", np.int8), ("ended", np.int64), ("hrd", np.float32),
        ("skip", np.bool_), ("nb_prior", np.int32), ("nw_prior", np.int32)]}
    dense, played, timed_out = {}, {}, {}
    for i, (size, hcap, komi, b, w, tpm, to, win, end, rules) in enumerate(rows):
        rules = ALIAS.get(rules, rules)
        if rules not in RULES:
            raise SystemExit(f"unknown rules {rules!r}")
        bi, wi = dense.setdefault(b, len(dense)), dense.setdefault(w, len(dense))
        speed = 3 if (tpm == 0 or tpm > 3600) else (2 if tpm > 15 else 1)
        result = 1 if win == b else 0 if win == w else -1
        # Only the first of a run of correspondence timeouts counts.
        skip = False
        if speed == 3:
            if to:
                loser, winner = (w, b) if win == b else (b, w)
                skip = timed_out.get(b, False) or timed_out.get(w, False)
                timed_out[loser], timed_out[winner] = True, False
            else:
                timed_out[b] = timed_out[w] = False
        skip = skip or result < 0
        for k, v in (("size", size), ("hcap", hcap), ("black", bi), ("white", wi), ("speed", speed),
                     ("timeout", bool(to)), ("result", result), ("ended", end), ("skip", skip),
                     ("hrd", handicap_rank_difference(hcap, size, komi, rules)),
                     ("nb_prior", played.get(bi, 0)), ("nw_prior", played.get(wi, 0))):
            cols[k][i] = v
        if not skip:  # a game against oneself counts once
            played[bi] = cols["nb_prior"][i] + 1
            played[wi] = cols["nw_prior"][i] + 1
    np.savez(out, **cols)
    print(f"{n} games, {len(dense)} players, {int(cols['skip'].sum())} skipped")


if __name__ == "__main__":
    main(*sys.argv[1:3])
