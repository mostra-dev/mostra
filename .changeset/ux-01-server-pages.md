---
"@mostra/runtime": minor
---

The server's own pages wear `@mostra/themes`: the API origin's sign-in, device, consent and "Sign-in can't continue" pages, and every refused navigation (an expired link, an unknown host), with no script and their stylesheet, faces and marks served by their own origin at `/_mostra/theme/*`. A new `appearance` configuration key names the server and dresses it (`theme`, `name`, `logo`, `stageLine`, `default`, `footer`); a person switches light or dark with one button, kept in the cookie `mostra-appearance`. Pages not dressed as Mostra say "Runs on Mostra", and the hosted chrome's made-with mark is on unless an operator's `policy.link` turns it off.
