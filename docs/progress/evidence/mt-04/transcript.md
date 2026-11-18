# MT-04 real run, 2026-11-16T09:48:27Z, macOS 26.2 arm64, Node v24.22.1

$ mostra --version
mostra: downloading the Mostra runtime (204 MB): 0%
mostra: downloading the Mostra runtime (204 MB): 25%
mostra: downloading the Mostra runtime (204 MB): 50%
mostra: downloading the Mostra runtime (204 MB): 75%
mostra: downloading the Mostra runtime (204 MB): 100%
mostra: checking the runtime's files…
mostra: fetching the browser verify uses…
0.15.1
npm notice
npm notice New major version of npm available! 11.19.1 -> 12.2.2
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.2
npm notice To update run: npm install -g npm@12.2.2
npm notice
[exit 0]
first run took 158 s

$ mostra new launch-check --title Atlas 2.0 launch: go or no-go
Created art_01M7HW9N9R01JBRRX6ZPPV1NJA in <run>/work/launch-check
  index.tsx
  AGENTS.md
  CLAUDE.md
[exit 0]

$ mostra docs guide/walkthrough
error MOSTRA_CLI_USAGE: No topic "guide/walkthrough". The nearest: guide, guide/answers, guide/page. Run "mostra docs" for the index.
  Run `mostra <command> --help` for the command's arguments and flags, then run it again.
  https://mostra-dev.github.io/mostra/errors/MOSTRA_CLI_USAGE
[exit 2]

$ mostra verify launch-check --screenshots always
verify: prepare
verify: compile
verify: boot
verify: render
verify: smoke
verify: regression
verify: fail
  error MOSTRA_TYPE_ERROR actions.ts:16:15: TS2532: Object is possibly 'undefined'.
    Fix the type error at the reported location; the message carries TypeScript's code and text.
  hint MOSTRA_VERIFY_NO_BASELINE: No earlier version of this artifact passed verify, so nothing was compared.
    Nothing to fix: the next version will be compared with this one once it is published.
  screenshot desktop: <run>/home/.mostra/cache/verify/3b5df4ddef52ed8ee1107215de2c2fa4be4579ff7899a1afe271ffc8f18651be/desktop.png
  screenshot mobile: <run>/home/.mostra/cache/verify/3b5df4ddef52ed8ee1107215de2c2fa4be4579ff7899a1afe271ffc8f18651be/mobile.png
[exit 1]
verify took 31 s

$ mostra verify launch-check --screenshots always
verify: prepare
verify: compile
verify: boot
verify: render
verify: smoke
verify: regression
verify: pass
  hint MOSTRA_VERIFY_NO_BASELINE: No earlier version of this artifact passed verify, so nothing was compared.
    Nothing to fix: the next version will be compared with this one once it is published.
  screenshot desktop: <run>/home/.mostra/cache/verify/a0514c2c5be9d5f45f44358a7824c7dab0cb69a43a44e46b67d2e24404d717ac/desktop.png
  screenshot mobile: <run>/home/.mostra/cache/verify/a0514c2c5be9d5f45f44358a7824c7dab0cb69a43a44e46b67d2e24404d717ac/mobile.png
[exit 0]

(looked at both screenshots; hid "0 of 0 answered" before anyone is named)

$ mostra verify launch-check --screenshots always
verify: prepare
verify: compile
verify: boot
verify: render
verify: smoke
verify: regression
verify: pass
  hint MOSTRA_VERIFY_NO_BASELINE: No earlier version of this artifact passed verify, so nothing was compared.
    Nothing to fix: the next version will be compared with this one once it is published.
  screenshot desktop: <run>/home/.mostra/cache/verify/75a7bf6eee7d9a7b62fb6255db608e026368e35b34b911d5762abac73645a6da/desktop.png
  screenshot mobile: <run>/home/.mostra/cache/verify/75a7bf6eee7d9a7b62fb6255db608e026368e35b34b911d5762abac73645a6da/mobile.png
[exit 0]

$ mostra publish launch-check
Published version 1 (ver_5M20RQ1JWNW0E1T1ZXF49B3FXZ) of art_01M7HW9N9R01JBRRX6ZPPV1NJA
http://127.0.0.1:28119/a/art_01M7HW9N9R01JBRRX6ZPPV1NJA#t=[redacted]
[exit 0]

$ mostra push launch-check done --value {"done":18,"total":24}
revision 1
[exit 0]

$ mostra roster add launch-check ada@example.com --name Ada Lovelace
ada@example.com  http://127.0.0.1:28119/a/art_01M7HW9N9R01JBRRX6ZPPV1NJA#t=[redacted]
Send each person their own link. Wait for everyone with: mostra wait launch-check --until submitted:all
[exit 0]

$ mostra roster add launch-check sam@example.com --name Sam Okafor
sam@example.com  http://127.0.0.1:28119/a/art_01M7HW9N9R01JBRRX6ZPPV1NJA#t=[redacted]
Send each person their own link. Wait for everyone with: mostra wait launch-check --until submitted:all
[exit 0]

$ mostra open launch-check --new --viewer ada@example.com --viewer-name Ada Lovelace --browser
No browser opened: none could be started here. Give the person the link.
http://127.0.0.1:28119/a/art_01M7HW9N9R01JBRRX6ZPPV1NJA#t=[redacted]
[exit 0]

$ mostra open launch-check --new --viewer ada@example.com --viewer-name Ada Lovelace --browser
http://127.0.0.1:28119/a/art_01M7HW9N9R01JBRRX6ZPPV1NJA#t=[redacted]
[exit 0]

$ mostra wait launch-check --until submitted:all --timeout 45s
roster.completed at cursor 20
[exit 0]

$ mostra push launch-check done --value {"done":21,"total":24}
revision 2
[exit 0]

$ mostra results launch-check --all
# Atlas 2.0 launch: go or no-go: submission sub_01M7HWPJDVPJK577J5MV81TGVD

- Artifact: art_01M7HW9N9R01JBRRX6ZPPV1NJA (`proposal`)
- Version: ver_5M20RQ1JWNW0E1T1ZXF49B3FXZ (version 1)
- View: vw_01M7HWN1QC28GEG6G66R4R5Z8W, channel shell, viewer "Ada Lovelace" (vwr_01M7HWJZ36N6VB14VEJ7P68343)
- Submitted: 2026-11-16T09:58:33.147Z, epoch 1, policy once per-viewer
- Draft revision 3, digest e8f7428be8926eca0631c47258eaa3c5382920ffc29b46e0c4b1b2698b775495
- Delivery: delivered (built-in: delivered)

## Answers
- "Go or no-go" (`decision`): "go"
- "Thursday 26 November" (`review.launch-date.choice`): "thu-26"
- "Risks you see" (`risks`): "The billing migration needs Sam's review before Thursday."

## Artifact state
- (none)

## Choices
- `launch-date`: "thu-26" ("Thursday 26 November")

## Comments
- (none)

## Actions run in this view
- `actions.ts#saveNote`: succeeded at 2026-11-16T09:58:22.405Z (run run_01M7HWP7Y5861TSJQNHYAMYAC8)

## Signals raised in this view
- (none)

## Not carried over from an earlier version
- (none)

---

# Atlas 2.0 launch: go or no-go: submission sub_01M7HWPZ3F5NRNMERW3VX91ZT6

- Artifact: art_01M7HW9N9R01JBRRX6ZPPV1NJA (`proposal`)
- Version: ver_5M20RQ1JWNW0E1T1ZXF49B3FXZ (version 1)
- View: vw_01M7HWN1W1CPPGSGQZR638RQDC, channel shell, viewer "Sam Okafor" (vwr_01M7HWK135NVQCW57YM8STCZPQ)
- Submitted: 2026-11-16T09:58:46.127Z, epoch 1, policy once per-viewer
- Draft revision 3, digest 0f052f756d999976ddfb85333374f890c7fc802e33e8fed31d37802744d6de1a
- Delivery: delivered (built-in: delivered)

## Answers
- "Go or no-go" (`decision`): "no-go"
- "Tuesday 1 December" (`review.launch-date.choice`): "tue-1"
- "Risks you see" (`risks`): "Support rota isn't staffed for the 26th; the help-centre articles aren't reviewed."

## Artifact state
- (none)

## Choices
- `launch-date`: "tue-1" ("Tuesday 1 December")

## Comments
- (none)

## Actions run in this view
- (none)

## Signals raised in this view
- (none)

## Not carried over from an earlier version
- (none)
[exit 0]

Agent to Ada: You and Sam split. You said go for Thursday 26 November, with one risk: the billing migration needs Sam's review first. Sam said no-go until Tuesday 1 December, because the support rota is not staffed for the 26th and the help-centre articles are not reviewed. Your "Save my answers as a note" button wrote notes/2026-11-16T09-58-22-413Z.md beside the page on this computer. I am adding the plan that follows from both answers to the page now.

$ mostra verify launch-check --screenshots always
verify: prepare
verify: compile
verify: boot
verify: render
verify: smoke
verify: regression
verify: pass
  screenshot desktop: <run>/home/.mostra/cache/verify/a68ad7ec07c8895d3854b743b464ba1144e5f38d9f1ac7d801e38707a91224bc/desktop.png
  screenshot mobile: <run>/home/.mostra/cache/verify/a68ad7ec07c8895d3854b743b464ba1144e5f38d9f1ac7d801e38707a91224bc/mobile.png
[exit 0]

$ mostra publish launch-check
Published version 2 (ver_0VPTKP7K3SM2T2832ADE1SQCDW) of art_01M7HW9N9R01JBRRX6ZPPV1NJA
http://127.0.0.1:28119/a/art_01M7HW9N9R01JBRRX6ZPPV1NJA#t=[redacted]
[exit 0]

(Ada switched to version 2: the plan shows, her answers carried over.)

Agent to Ada: That was a page you and Sam answered from your own links, with a number that moved while you looked, a button that saved a real note, and both answers back with me to plan from. Places in your work where this fits: the weekly launch check-in, client sign-offs on release notes, and picking interview slots with your panel. Nothing more to set up: ask me for the next one whenever you like.

$ mostra list
art_01M7HW9N9R01JBRRX6ZPPV1NJA  v2  Atlas 2.0 launch: go or no-go  <run>/work/launch-check
[exit 0]

$ mostra status
{
  "instance": {
    "version": "0.15.1",
    "home": "<run>/home/.mostra",
    "platform": "darwin-arm64",
    "pid": 27869,
    "mode": "daemon"
  },
  "startedAt": "2026-11-16T09:51:29.888Z",
  "socket": "<run>/home/.mostra/run/4HFKAR4F2ARFCSDV.sock",
  "connections": 1,
  "processes": [
    {
      "pid": 43197,
      "kind": "verify",
      "ownerRef": "verify-runner",
      "startedAt": "2026-11-16T09:54:02.122Z"
    },
    {
      "pid": 61323,
      "kind": "worker",
      "ownerRef": "ver_5M20RQ1JWNW0E1T1ZXF49B3FXZ",
      "startedAt": "2026-11-16T09:57:43.680Z"
    },
    {
      "pid": 71931,
      "kind": "worker",
      "ownerRef": "ver_0VPTKP7K3SM2T2832ADE1SQCDW",
      "startedAt": "2026-11-16T09:59:57.898Z"
    }
  ],
  "gateway": {
    "bind": "127.0.0.1",
    "shell": "http://127.0.0.1:28119",
    "artifacts": [
      {
        "artifactId": "art_01M7HW9N9R01JBRRX6ZPPV1NJA",
        "origin": "http://127.0.0.1:32001"
      }
    ],
    "faces": []
  },
  "deliveries": [
    {
      "owner": "",
      "connected": true,
      "pending": 0,
      "delivered": 2,
      "rejected": 0,
      "undeliverable": 0
    }
  ],
  "workers": [
    {
      "artifactId": "art_01M7HW9N9R01JBRRX6ZPPV1NJA",
      "versionId": "ver_5M20RQ1JWNW0E1T1ZXF49B3FXZ",
      "state": "ready",
      "pid": 61323,
      "crashes": 0,
      "active": 0
    },
    {
      "artifactId": "art_01M7HW9N9R01JBRRX6ZPPV1NJA",
      "versionId": "ver_0VPTKP7K3SM2T2832ADE1SQCDW",
      "state": "ready",
      "pid": 71931,
      "crashes": 0,
      "active": 1
    }
  ],
  "shares": [],
  "links": []
}
[exit 0]

## The hosted way (2026-11-16)

$ mostra login https://api.mostradev.com
Open https://api.mostradev.com/device?user_code=WLTP-LZKJ and check that it shows the code WLTP-LZKJ, then approve.
Waiting for you to approve…Signed in to https://api.mostradev.com as MirzaBicer. This machine is lnk_01M7J00N2QM8EED4XJ9EXJVAJW.
[exit 0]

$ mostra new launch-hosted --title Atlas 2.0 launch: go or no-go
Created art_01M7J0B5MCAK9BZEFSKA7DAKP9 in <run>/work/launch-hosted
  index.tsx
  AGENTS.md
  CLAUDE.md
[exit 0]

(launch-hosted: the same page as a new artifact, art_01M7J0B5MCAK9BZEFSKA7DAKP9, for the hosted way)

$ mostra verify launch-hosted --screenshots always
verify: prepare
verify: compile
verify: boot
verify: render
verify: smoke
verify: regression
verify: pass
  hint MOSTRA_VERIFY_NO_BASELINE: No earlier version of this artifact passed verify, so nothing was compared.
    Nothing to fix: the next version will be compared with this one once it is published.
  screenshot desktop: <run>/home/.mostra/cache/verify/b72c90101cc1568f6eb212ade4f1f9b5dd856a76d3400d20489f79dc135567c7/desktop.png
  screenshot mobile: <run>/home/.mostra/cache/verify/b72c90101cc1568f6eb212ade4f1f9b5dd856a76d3400d20489f79dc135567c7/mobile.png
[exit 0]

$ mostra publish launch-hosted
Published version 1 (ver_NA6KHMQ021TN9P8XC23GXAJ7F9) of art_01M7J0B5MCAK9BZEFSKA7DAKP9
http://127.0.0.1:28119/a/art_01M7J0B5MCAK9BZEFSKA7DAKP9#t=[redacted]
[exit 0]

$ mostra share launch-hosted --cloud --respondent ada@example.com,sam@example.com
https://mostrausercontent.com/a/rte_01M7J0DXQD02GHJMQ53Z6AA3YV#t=[redacted]
Shared through a remote server, hosted, until you stop it.
Personal links:
ada@example.com  https://mostrausercontent.com/a/rte_01M7J0DXQD02GHJMQ53Z6AA3YV#t=[redacted]
sam@example.com  https://mostrausercontent.com/a/rte_01M7J0DXQD02GHJMQ53Z6AA3YV#t=[redacted]
Stop it with: mostra share stop shr_01M7J0E1VR458M3ZF4951CXQRN
[exit 0]

$ mostra roster add launch-hosted ada@example.com --name Ada Lovelace
ada@example.com  https://mostrausercontent.com/a/rte_01M7J0DXQD02GHJMQ53Z6AA3YV#t=[redacted]
Send each person their own link. Wait for everyone with: mostra wait launch-hosted --until submitted:all
[exit 0]

$ mostra roster add launch-hosted sam@example.com --name Sam Okafor
sam@example.com  https://mostrausercontent.com/a/rte_01M7J0DXQD02GHJMQ53Z6AA3YV#t=[redacted]
Send each person their own link. Wait for everyone with: mostra wait launch-hosted --until submitted:all
[exit 0]

$ mostra push launch-hosted done --value {"done":18,"total":24}
revision 1
[exit 0]

$ mostra roster get launch-hosted
Round 1: 0 of 2 submitted, 0 drafting, 2 not opened.
  not-opened ada@example.com  Ada Lovelace
  not-opened sam@example.com  Sam Okafor
[exit 0]

$ mostra wait launch-hosted --until submitted:all --timeout 30s
still waiting; resume with --after 43
[exit 5]

$ mostra push launch-hosted done --value {"done":19,"total":24}
revision 2
[exit 0]

$ mostra wait launch-hosted --until submitted:all --timeout 30s
still waiting; resume with --after 43
[exit 5]

$ mostra push launch-hosted done --value {"done":20,"total":24}
revision 3
[exit 0]

$ mostra wait launch-hosted --until submitted:all --timeout 30s
still waiting; resume with --after 43
[exit 5]

$ mostra push launch-hosted done --value {"done":21,"total":24}
revision 4
[exit 0]

$ mostra wait launch-hosted --until submitted:all --timeout 30s
still waiting; resume with --after 44
[exit 5]

$ mostra push launch-hosted done --value {"done":22,"total":24}
revision 5
[exit 0]

$ mostra wait launch-hosted --until submitted:all --timeout 30s
still waiting; resume with --after 44
[exit 5]

$ mostra push launch-hosted done --value {"done":23,"total":24}
revision 6
[exit 0]

$ mostra wait launch-hosted --until submitted:all --timeout 30s
still waiting; resume with --after 44
[exit 5]

$ mostra push launch-hosted done --value {"done":24,"total":24}
revision 7
[exit 0]

$ mostra wait launch-hosted --until submitted:all --timeout 30s
still waiting; resume with --after 44
[exit 5]

$ mostra push launch-hosted done --value {"done":25,"total":24}
revision 8
[exit 0]

$ mostra wait launch-hosted --until submitted:all --timeout 30s
still waiting; resume with --after 44
[exit 5]

$ mostra push launch-hosted done --value {"done":26,"total":24}
revision 9
[exit 0]

$ mostra wait launch-hosted --until submitted:all --timeout 30s
still waiting; resume with --after 44
[exit 5]

$ mostra push launch-hosted done --value {"done":27,"total":24}
revision 10
[exit 0]

$ mostra wait launch-hosted --until submitted:all --timeout 30s
still waiting; resume with --after 44
[exit 5]

$ mostra push launch-hosted done --value {"done":28,"total":24}
revision 11
[exit 0]

(The wait loop above pushed past the total: the demo's own counting slip, stopped; a fresh loop follows. Sam's first link, as share --respondent printed it, acted as an unnamed visitor: #184. He answers from the link roster add gave him.)

$ mostra push launch-hosted done --value {"done":20,"total":24}
revision 12
[exit 0]

$ mostra wait launch-hosted --until submitted:all --timeout 30s
still waiting; resume with --after 57
[exit 5]

$ mostra push launch-hosted done --value {"done":21,"total":24}
revision 13
[exit 0]

$ mostra wait launch-hosted --until submitted:all --timeout 30s
roster.completed at cursor 64
[exit 0]

$ mostra results launch-hosted --all
# Atlas 2.0 launch: go or no-go: submission sub_01M7J125X1NQETCXPSA0RV3JMZ

- Artifact: art_01M7J0B5MCAK9BZEFSKA7DAKP9 (`proposal`)
- Version: ver_NA6KHMQ021TN9P8XC23GXAJ7F9 (version 1)
- View: vw_01M7J11WDMPNWRK8BBW40G6J62, channel shell, viewer "Ada Lovelace" (vwr_01M7J0E23JTZFVV218ND5SKJVJ)
- Submitted: 2026-11-16T11:14:47.841Z, epoch 1, policy once per-viewer
- Draft revision 3, digest 307cc2922929257320489445f41fc460b1718a2587de59aa06ce982752e8982e
- Delivery: delivered (built-in: delivered)

## Answers
- "Go or no-go" (`decision`): "go"
- "Thursday 26 November" (`review.launch-date.choice`): "thu-26"
- "Risks you see" (`risks`): "The billing migration needs Sam's review before Thursday."

## Artifact state
- (none)

## Choices
- `launch-date`: "thu-26" ("Thursday 26 November")

## Comments
- (none)

## Actions run in this view
- `actions.ts#saveNote`: succeeded at 2026-11-16T11:14:46.776Z (run run_01M7J124VR5NG1MX5PK8B6K2CV)

## Signals raised in this view
- (none)

## Not carried over from an earlier version
- (none)

---

# Atlas 2.0 launch: go or no-go: submission sub_01M7J12R0CPHD1EEN4DNV62YKB

- Artifact: art_01M7J0B5MCAK9BZEFSKA7DAKP9 (`proposal`)
- Version: ver_NA6KHMQ021TN9P8XC23GXAJ7F9 (version 1)
- View: vw_01M7J0M1TCPV812X3AXF4904B0, channel shell, viewer "Sam Okafor" (vwr_01M7J0E23M7VMX1BC51E64FDE7)
- Submitted: 2026-11-16T11:15:06.380Z, epoch 1, policy once per-viewer
- Draft revision 3, digest e2731f4fdd8a23075c2ebf0a4b618a9264504dfcce2b6cd34544ac4fcb9218c5
- Delivery: delivered (built-in: delivered)

## Answers
- "Go or no-go" (`decision`): "no-go"
- "Tuesday 1 December" (`review.launch-date.choice`): "tue-1"
- "Risks you see" (`risks`): "Support rota isn't staffed for the 26th; the help-centre articles aren't reviewed."

## Artifact state
- (none)

## Choices
- `launch-date`: "tue-1" ("Tuesday 1 December")

## Comments
- (none)

## Actions run in this view
- (none)

## Signals raised in this view
- (none)

## Not carried over from an earlier version
- (none)
[exit 0]

$ mostra verify launch-hosted
verify: prepare
verify: compile
verify: boot
verify: render
verify: smoke
verify: regression
verify: pass
[exit 0]

$ mostra publish launch-hosted
Published version 2 (ver_5MQ5V6E4DESAZN2HJY8WMYVHVN) of art_01M7J0B5MCAK9BZEFSKA7DAKP9
http://127.0.0.1:28119/a/art_01M7J0B5MCAK9BZEFSKA7DAKP9#t=[redacted]
[exit 0]

## The public tunnel, for the second person (2026-11-16)

$ mostra share launch-check --public --viewer sam@example.com --viewer-name Sam Okafor --ttl 30m
https://lauderdale-therapy-slip-preston.trycloudflare.com/a/art_01M7HW9N9R01JBRRX6ZPPV1NJA#t=[redacted]
Shared through a Cloudflare quick tunnel, public, until 2026-11-16T11:47:47.416Z.
Stop it with: mostra share stop shr_01M7J17EKW74D4AH14XR61Y1ES
[exit 0]

$ mostra share stop shr_01M7J17EKW74D4AH14XR61Y1ES
Stopped shr_01M7J17EKW74D4AH14XR61Y1ES
[exit 0]

$ mostra share stop repro-respondents
Stopped shr_01M7J10T63Y3YQ437JY1XZGHA2
[exit 0]

$ mostra share list
shr_01M7J0E1VR458M3ZF4951CXQRN  remote  mostrausercontent.com  no expiry
[exit 0]
