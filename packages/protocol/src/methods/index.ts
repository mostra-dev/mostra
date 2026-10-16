/**
 * Every host protocol method this package defines. `pnpm gen protocol-method` adds entries at the
 * markers; the method itself lives in its own module under `methods/<group>/`.
 */
import type { AnyMethod } from "../method.ts";
import { artifactCreateMethod } from "./artifact/create.ts";
import { artifactGetMethod } from "./artifact/get.ts";
import { artifactListMethod } from "./artifact/list.ts";
import { artifactPublishMethod } from "./artifact/publish.ts";
import { depsAddMethod } from "./deps/add.ts";
import { eventsAckMethod } from "./events/ack.ts";
import { eventsReadMethod } from "./events/read.ts";
import { eventsSubscribeMethod } from "./events/subscribe.ts";
import { eventsUnsubscribeMethod } from "./events/unsubscribe.ts";
import { instanceStatusMethod } from "./instance/status.ts";
import { livePushMethod } from "./live/push.ts";
import { mostraInitializeMethod } from "./mostra/initialize.ts";
import { mostraShutdownMethod } from "./mostra/shutdown.ts";
import { portDraftsMirrorMethod } from "./port/drafts-mirror.ts";
import { portSecretsGetMethod } from "./port/secrets-get.ts";
import { portSubmissionsDeliverMethod } from "./port/submissions-deliver.ts";
import { portTrustedControlsActivatedMethod } from "./port/trusted-controls-activated.ts";
import { portTrustedControlsPolicyMethod } from "./port/trusted-controls-policy.ts";
import { resultsGetMethod } from "./results/get.ts";
import { secretDeleteMethod } from "./secret/delete.ts";
import { secretListMethod } from "./secret/list.ts";
import { secretSetMethod } from "./secret/set.ts";
import { stateGetMethod } from "./state/get.ts";
import { statePatchMethod } from "./state/patch.ts";
import { viewRevokeMethod } from "./view/revoke.ts";
import { viewRotateMethod } from "./view/rotate.ts";
import { viewUrlMethod } from "./view/url.ts";
import { waitMethod } from "./wait/wait.ts";
// gen:method-imports

/** Every host protocol method, in the order they were added. */
export const hostMethods: readonly AnyMethod[] = [
  mostraInitializeMethod,
  mostraShutdownMethod,
  instanceStatusMethod,
  artifactCreateMethod,
  artifactPublishMethod,
  artifactListMethod,
  artifactGetMethod,
  depsAddMethod,
  viewUrlMethod,
  viewRevokeMethod,
  viewRotateMethod,
  stateGetMethod,
  resultsGetMethod,
  waitMethod,
  eventsReadMethod,
  eventsSubscribeMethod,
  eventsUnsubscribeMethod,
  statePatchMethod,
  eventsAckMethod,
  portSubmissionsDeliverMethod,
  portDraftsMirrorMethod,
  portTrustedControlsPolicyMethod,
  portTrustedControlsActivatedMethod,
  secretSetMethod,
  secretListMethod,
  secretDeleteMethod,
  livePushMethod,
  portSecretsGetMethod,
  // gen:methods
];
