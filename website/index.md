---
layout: home
title: Rate Limit Tracker for X

hero:
  name: "Rate Limit Tracker for\u00a0X"
  text: Know your limits before X enforces them
  tagline: A browser extension that reads X's rate limits from the requests your browser already makes. Nothing is sent anywhere.
  image:
    src: /logo.png
    alt: Rate Limit Tracker for X logo
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: How it works
      link: /guide/how-it-works
    - theme: alt
      text: Privacy
      link: /privacy

features:
  - title: Live limits
    details: Remaining requests, reset countdowns and 24-hour counts for follows, unfollows, posts and likes.
  - title: Catches hidden limits
    details: X often enforces a limit with an error code rather than a 429, such as a follow limit sent as HTTP 403 with error 161. The extension catches both.
  - title: Every endpoint
    details: Every X API endpoint that reports a rate limit, sorted by how close each one is to running out.
  - title: Track what you want
    details: Choose which actions to watch and show on the home screen, or add any endpoint by name, path or URL.
  - title: Private by design
    details: Never reads cookies, tokens or request headers. Data stays in your browser, with no servers, analytics or tracking.
  - title: Chrome, Firefox and Safari
    details: One open-source codebase, MIT licensed, built for all three browsers.
---

<div class="vp-doc" style="max-width: 1152px; margin: 64px auto 0; padding: 0 24px;">

<img class="shot" src="../store/screenshot-1-home.png" alt="The popup's home screen showing follow, post and like limits, with a detected HTTP 429 on follow">

</div>
