import { defineConfig } from 'vitepress';

// Set BASE when hosting under a sub-path, e.g. BASE=/x-ratelimit/ for
// GitHub Pages project sites.
const base = process.env.BASE ?? '/';

export default defineConfig({
  title: 'Rate Limit Tracker for X',
  description: 'See X (Twitter) rate limits, reset countdowns and limit errors from the requests your browser already makes.',
  base,
  lang: 'en-US',
  cleanUrls: true,
  lastUpdated: false,
  head: [
    ['link', { rel: 'icon', type: 'image/png', href: `${base}favicon.png` }],
    ['meta', { name: 'theme-color', content: '#0f1419' }],
  ],
  vite: {
    // Pages reference the store screenshots and PRIVACY.md one level up.
    server: { fs: { allow: ['..'] } },
  },
  themeConfig: {
    logo: '/logo.png',
    nav: [
      { text: 'Guide', link: '/guide/getting-started', activeMatch: '/guide/' },
      { text: 'Privacy', link: '/privacy' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting started', link: '/guide/getting-started' },
            { text: 'Using the popup', link: '/guide/using' },
            { text: 'Rate limits on X', link: '/guide/limits' },
            { text: 'How it works', link: '/guide/how-it-works' },
          ],
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/toneflix/x-ratelimit' }],
    editLink: {
      pattern: 'https://github.com/toneflix/x-ratelimit/edit/main/website/:path',
      text: 'Edit this page on GitHub',
    },
    search: { provider: 'local' },
    footer: {
      message: 'Released under the MIT License. Not affiliated with or endorsed by X Corp.',
    },
  },
});
