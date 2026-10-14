import { defineConfig } from 'vocs/config'

// The site title (top left) leads back to the game, not the docs' home. Vocs
// hardcodes its link to '/', so this points it at surround.gg: the href for
// hovering and opening in a new tab, and a capturing click so Vocs's
// client-side router never sees it.
const GAME_URL = 'https://surround.gg'
const titleLink = `(() => {
  const url = ${JSON.stringify(GAME_URL)};
  const selector = '[data-v-logo] a, a[data-v-logo-link]';
  const point = () =>
    document.querySelectorAll(selector).forEach((a) => {
      if (a.getAttribute('href') !== url) a.setAttribute('href', url);
    });
  document.addEventListener('click', (event) => {
    const a = event.target instanceof Element && event.target.closest(selector);
    if (!a || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    location.href = url;
  }, true);
  new MutationObserver(point).observe(document.documentElement, {
    subtree: true, childList: true, attributes: true, attributeFilter: ['href'],
  });
  point();
})()`

export default defineConfig({
  title: 'Surround',
  renderStrategy: 'full-static',
  checkDeadlinks: true,
  // The web app's mark (apps/web/public), shared so both sites read as one.
  iconUrl: '/surround-mark.svg',
  head: {
    link: [{ rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }],
    script: [{ innerHTML: titleLink }],
  },
  description:
    'Go played offchain, settled on Starknet, with onchain ratings, AI anchors and kifu.',
  editLink: {
    link: 'https://github.com/broody/surround/edit/main/apps/docs/src/pages/:path',
    text: 'Edit on GitHub',
  },
  socials: [{ icon: 'github', link: 'https://github.com/broody/surround' }],
  sidebar: [
    { text: 'Overview', link: '/' },
    {
      text: 'Gameplay',
      items: [
        { text: 'Playing a game', link: '/gameplay/playing' },
        { text: 'Scoring', link: '/gameplay/scoring' },
        { text: 'How a game ends', link: '/gameplay/ending' },
      ],
    },
    {
      text: 'Settlement',
      items: [
        { text: 'Offchain play', link: '/settlement/offchain-play' },
        { text: 'Settling a game', link: '/settlement/settling' },
        { text: 'Disputes', link: '/settlement/disputes' },
        { text: 'Ranked clocks', link: '/settlement/clocks' },
      ],
    },
    {
      text: 'Ranking',
      items: [
        { text: 'How a game is rated', link: '/ranking/rated-games' },
        { text: 'The rating model', link: '/ranking/model' },
        { text: 'Ranks', link: '/ranking/ranks' },
        { text: 'Evidence', link: '/ranking/evidence' },
        { text: 'Trust and policy', link: '/ranking/trust' },
      ],
    },
    { text: 'AI anchors', link: '/ai-anchors' },
    { text: 'Fair play', link: '/fair-play' },
    { text: 'Kifu', link: '/kifu' },
  ],
})
