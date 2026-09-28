# Rating backtest

Replays OGS's public ranked games to calibrate Surround's rating model
([RANKING_PLAN.md](../../RANKING_PLAN.md)). Every system predicts each game
before seeing its result, and `evaluate.py` scores all of them on the same
games.

## Data

OGS's database (2.4 GB, about 30.8M ranked games from 2005 to 2023) is in
[online-go/goratings](https://github.com/online-go/goratings) through Git LFS:

```sh
git clone --depth 1 https://github.com/online-go/goratings.git
curl -L -o ogs-data.db https://media.githubusercontent.com/media/online-go/goratings/master/data/ogs-data.db
echo "1d89d61d332f3b9b9d6cae54dac1fec7bddf6f392fa62e81f4eba95aa8ec4254  ogs-data.db" | sha256sum -c -
```

## Run

Python 3 with numpy. The `data/` directory is ignored.

```sh
mkdir -p data
python3 prep.py ogs-data.db data/games.npz                          # ~4 min, 30.4M games
python3 systems.py surround data/games.npz data/pred_surround.npz   # ~5 min
GORATINGS=goratings python3 systems.py ogs data/games.npz data/pred_ogs.npz   # ~16 min
python3 evaluate.py data/games.npz data/pred_surround.npz data/pred_ogs.npz
```

`run_surround` takes the model's constants as keyword arguments (`phi0`,
`drift`, `start`, `clamp`), so a refit is a loop over them, scored on the
first 70% of games and reported on the last 30%. OGS's data has no starting
bands, so every player starts at rating 1500 (`start=0`); OGS's handicap games
enter through their head start in ranks (`hrd`). Surround's own games replace
OGS's once there are enough of them.
