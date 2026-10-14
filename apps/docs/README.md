# Surround docs

Surround's documentation site, built with [Vocs](https://vocs.dev): how games
settle on Starknet, how ranked games are rated, the AI anchors and kifu.
Pages are MDX in `src/pages`; the sidebar is in `vocs.config.ts`.

```sh
npm ci --prefix apps/docs
npm run dev --prefix apps/docs      # http://localhost:5190
npm run build --prefix apps/docs
```

`public/kifu-example.svg` is a real kifu's `svg` view, read from the Sepolia
world v8 Kifu contract (game `cgos_9_1682833`).
