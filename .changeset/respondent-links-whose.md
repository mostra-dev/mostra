---
"@mostra/runtime": patch
"@mostra/shell": patch
---

A respondent who opens their personal link in a browser that already has the artifact open from another link, such as the share's own link, now sees whose each link is (#184). The choice between the two links described each only by what it allows, so a personal link and the share's link read the same, "Keep the link I have" was the first choice, and keeping it answered as an unnamed visitor whose roster entry stayed "not opened". Each link now says "A personal link, for <name>" or "A shared link", by display name only (never the host's ref or an email), and when the opened link is a personal one and the open one isn't, "Use the personal link" comes first. The owner's `share/start` and the hosted `roster/add` also refuse to hand out a respondent link that is the share's own, another respondent's, or acts as nobody, naming the respondent and never a secret; a respondent's kept link must act as them; and the owner logs the respondents' token IDs (`share.respondents`) when a hosted share names them.
