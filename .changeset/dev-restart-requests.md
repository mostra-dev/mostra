---
"@mostra/runtime": patch
---

`mostra dev` no longer leaves a page blank when its dev server restarts while the page loads (#164). A restart (after `mostra add` changed the packages, or the manifest changed) switches the session to a new dev server and then stops the old one, which cut the module requests the old one was still answering; the preview answered them with a 502 and the page, missing a module, never rendered until it was loaded again by hand. The preview now sends such a request again to the dev server that replaced the old one, for a GET or a HEAD only and at most three times, and the dev session logs why each restart happened (`dev.restarted`: packages, manifest, the files), as the preview logs each request it sent again or couldn't answer.
