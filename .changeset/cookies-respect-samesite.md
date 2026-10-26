---
'searchcast': minor
---

The transport session's cookie store now keeps each cookie's `SameSite` (`Strict`, `Lax`, `None`; absent or unknown is Chrome's default, `Lax`) and sends a cross-site `fetch` or `script` request (its `sec-fetch-site` is `cross-site`, `fetchSite` override included) only the `SameSite=None` cookies, as Chromium was measured to do; same-origin and same-site requests and navigations still get every matching cookie. A `SameSite=None` cookie without `Secure` is rejected, from `Set-Cookie` and from `ctx.cookies.set` alike. `StoredCookie` gains `sameSite`; a cookie saved before it loads as `Lax`. `CookieStore.header(url, now, {crossSite, topLevelNavigation})` applies the rule (a cross-site top-level navigation also gets the `Lax` cookies, never the `Strict` ones), and the `SameSite` and `CookieRequestContext` types are exported.
