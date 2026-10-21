//! The generated wire types survive additive change (HO-07, D143 item 3): unknown fields are
//! ignored, unknown enum values and union members are kept and serialized back unchanged, and
//! times stay the strings the instance sent.

use mostra_host::wire::{self, Method, SubmissionPolicy, Viewer, ViewerKind, WaitResult, methods};
use serde_json::{Value, json};

#[test]
fn a_string_enum_keeps_a_value_it_does_not_know() {
    let kind: ViewerKind = serde_json::from_value(json!("robot")).unwrap();
    assert!(matches!(&kind, ViewerKind::Unknown(value) if value == "robot"));
    assert_eq!(serde_json::to_value(&kind).unwrap(), json!("robot"));
    assert_eq!(kind.to_string(), "robot");
    let known: ViewerKind = serde_json::from_value(json!("host")).unwrap();
    assert!(matches!(known, ViewerKind::Host));
    assert_eq!(known.as_str(), "host");
    assert!(matches!(
        "tailnet".parse::<ViewerKind>().unwrap(),
        ViewerKind::Tailnet
    ));
}

#[test]
fn an_object_ignores_fields_a_newer_instance_adds() {
    let viewer: Viewer = serde_json::from_value(json!({
        "id": "vwr_01JB8Z3QF6S7W3N8D5K2C4V9XG",
        "kind": "local",
        "presence": { "online": true }
    }))
    .unwrap();
    assert!(matches!(viewer.kind, ViewerKind::Local));
}

#[test]
fn a_tagged_union_keeps_a_member_it_does_not_know() {
    let satisfied: WaitResult = serde_json::from_value(json!({
        "status": "still_waiting",
        "cursor": "12"
    }))
    .unwrap();
    assert!(matches!(satisfied, WaitResult::StillWaiting { .. }));
    let later = json!({ "status": "paused", "cursor": "12", "until": "2026-11-01T00:00:00.000Z" });
    let unknown: WaitResult = serde_json::from_value(later.clone()).unwrap();
    assert!(matches!(&unknown, WaitResult::Unknown(value) if *value == later));
    assert_eq!(serde_json::to_value(&unknown).unwrap(), later);

    let policy: SubmissionPolicy = serde_json::from_value(json!({ "policy": "twice" })).unwrap();
    assert!(matches!(policy, SubmissionPolicy::Unknown(_)));
    let once: SubmissionPolicy =
        serde_json::from_value(json!({ "policy": "once", "scope": "per-viewer" })).unwrap();
    assert!(matches!(once, SubmissionPolicy::Once { .. }));
}

#[test]
fn times_stay_the_strings_the_instance_sent() {
    let at = "2026-10-21T00:15:19.500Z";
    let record: wire::EventRecord = serde_json::from_value(json!({
        "cursor": "7",
        "artifactId": "art_01JB8Z3QF6S7W3N8D5K2C4V9XG",
        "seq": 3,
        "type": "submission.created",
        "at": at,
        "actor": { "kind": "viewer" },
        "payload": {}
    }))
    .unwrap();
    let back: Value = serde_json::to_value(&record).unwrap();
    assert_eq!(back["at"], json!(at));
}

#[test]
fn the_method_table_names_each_method_once_with_its_types() {
    assert_eq!(
        <methods::ArtifactPublish as Method>::NAME,
        "artifact/publish"
    );
    const { assert!(<methods::ArtifactPublish as Method>::MUTATING) };
    assert_eq!(
        <methods::PortIdentityResolve as Method>::DIRECTION,
        wire::Direction::InstanceToHost
    );
    let mut names: Vec<&str> = methods::METHODS.iter().map(|m| m.name).collect();
    let count = names.len();
    names.dedup();
    assert_eq!(names.len(), count);
    assert!(names.contains(&"wait"));
    assert_eq!(
        methods::NOTIFICATIONS,
        &["artifact/progress", "dev/notify", "events/notify"]
    );
}

/// Every answer of a submissions port decodes as its own member and serializes back unchanged:
/// a refusal keeps its reason and retry flag (Opus review of WP-12, finding 1).
#[test]
fn a_delivery_answer_decodes_as_its_own_member() {
    use mostra_host::wire::PortSubmissionsDeliverResult as Answer;
    let accepted = json!({ "accepted": true });
    let refused = json!({ "accepted": false, "reason": "busy", "retry": true });
    assert!(matches!(
        serde_json::from_value::<Answer>(accepted.clone()).unwrap(),
        Answer::Variant0 { .. }
    ));
    let decoded = serde_json::from_value::<Answer>(refused.clone()).unwrap();
    let Answer::Variant1 { reason, retry, .. } = &decoded else {
        panic!("a refusal decoded as {decoded:?}");
    };
    assert_eq!((reason.as_str(), *retry), ("busy", true));
    assert_eq!(serde_json::to_value(&decoded).unwrap(), refused);
    assert_eq!(
        serde_json::to_value(serde_json::from_value::<Answer>(accepted.clone()).unwrap()).unwrap(),
        accepted
    );
}
