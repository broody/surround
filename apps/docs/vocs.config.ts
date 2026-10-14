import { defineConfig } from 'vocs/config'

export default defineConfig({
  title: 'Surround',
  renderStrategy: 'full-static',
  checkDeadlinks: true,
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
