// PostHog on kitaab.plusminushalf.com, the same way as pitwall.plusminushalf.com: page views,
// clicks (autocapture: which Download button) and errors, to PostHog's EU cloud through its
// managed reverse proxy on our own domain, so blockers that drop *.posthog.com don't drop them.
// The key is public, every event sends it. Nothing is sent from localhost or a file on disk.
// PostHog keeps a random visitor ID in localStorage, no cookie.
//
// Kitaab's project key, the same one as POSTHOG.key in packages/core/src/analytics.ts.
;(function () {
  var KEY = ""
  var HOST = "https://a.pitwall.plusminushalf.com"
  var LOCAL = /^(localhost|127(\.\d+){3}|\[::1\])$|\.localhost$/
  if (!KEY || location.protocol === "file:" || LOCAL.test(location.hostname)) return

  // What the official snippet leaves behind: array.js picks up the queued init (_i) when it loads.
  window.posthog = Object.assign([], {
    __SV: 1,
    _i: [
      [
        KEY,
        {
          api_host: HOST,
          // Behind the proxy, PostHog's own links (toolbar, replays) still point at the EU app.
          ui_host: "https://eu.posthog.com",
          defaults: "2026-05-30",
          person_profiles: "identified_only",
          persistence: "localStorage",
          loaded: function (ph) {
            ph.register({ app: "kitaab-site" })
          },
        },
        "posthog",
      ],
    ],
  })
  var s = document.createElement("script")
  s.async = true
  s.crossOrigin = "anonymous"
  s.src = HOST + "/static/array.js"
  document.head.append(s)
})()
