//! The committed wire types are exactly what the schema generates (the wire-type snapshot test,
//! HO-03), and a schema outside the subset typify handles fails generation (D143 item 3).

use std::path::PathBuf;

use serde_json::json;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

#[test]
fn the_committed_wire_types_match_the_schema() {
    let schema = std::fs::read_to_string(root().join(mostra_host_codegen::SCHEMA)).unwrap();
    let generated = mostra_host_codegen::generate(&schema).unwrap();
    let wire = std::fs::read_to_string(root().join(mostra_host_codegen::WIRE_OUT)).unwrap();
    let methods = std::fs::read_to_string(root().join(mostra_host_codegen::METHODS_OUT)).unwrap();
    assert!(
        wire == generated.wire && methods == generated.methods,
        "the committed wire types are out of date: run `cargo run -p mostra-host-codegen -- write`"
    );
}

fn bundle(definitions: &serde_json::Value) -> String {
    json!({
        "$schema": "http://json-schema.org/draft-07/schema#",
        "x-mostra-methods": {},
        "definitions": definitions,
    })
    .to_string()
}

#[test]
fn a_schema_outside_the_subset_fails_naming_the_place() {
    let cases = [
        (
            json!({ "T": { "type": "array", "prefixItems": [{ "type": "string" }] } }),
            "definitions.T.prefixItems",
        ),
        (
            json!({ "T": { "type": "object", "properties": { "a": { "$ref": "other.json#/A" } } } }),
            "definitions.T.properties.a.$ref",
        ),
        (
            json!({ "T": { "type": "string", "format": "email" } }),
            "definitions.T.format",
        ),
        (
            json!({ "T": { "if": { "type": "string" }, "then": { "minLength": 1 } } }),
            "definitions.T.if",
        ),
        (
            json!({ "T": { "anyOf": [{ "not": { "type": "null" } }] } }),
            "definitions.T.anyOf[0].not",
        ),
    ];
    for (definitions, place) in cases {
        let error = mostra_host_codegen::generate(&bundle(&definitions)).unwrap_err();
        assert!(error.contains(place), "{error} should name {place}");
    }
}

#[test]
fn the_subset_generates() {
    let generated = mostra_host_codegen::generate(&bundle(&json!({
        "T": {
            "type": "object",
            "properties": {
                "at": { "type": "string", "format": "date-time" },
                "kind": { "type": "string", "enum": ["a", "b"] }
            },
            "required": ["at", "kind"]
        }
    })))
    .unwrap();
    assert!(generated.wire.contains("pub at: ::std::string::String"));
    assert!(generated.wire.contains("Unknown(::std::string::String)"));
}

/// An untagged union whose later member serde would decode as an earlier one fails generation;
/// one told apart by a boolean constant generates, with the constant as a type of its own (Opus
/// review of WP-12, finding 1).
#[test]
fn an_ambiguous_union_fails_and_a_boolean_constant_tells_members_apart() {
    let ambiguous = json!({
        "Answer": { "anyOf": [
            { "type": "object", "properties": { "ok": { "type": "boolean" } }, "required": ["ok"] },
            { "type": "object",
              "properties": { "ok": { "type": "boolean" }, "reason": { "type": "string" } },
              "required": ["ok", "reason"] }
        ] }
    });
    let error = mostra_host_codegen::generate(&bundle(&ambiguous)).unwrap_err();
    assert!(
        error.contains("definitions.Answer.anyOf: member 1"),
        "{error}"
    );
    let constant = json!({
        "Answer": { "anyOf": [
            { "type": "object", "properties": { "ok": { "type": "boolean", "const": true } }, "required": ["ok"] },
            { "type": "object",
              "properties": { "ok": { "type": "boolean", "const": false }, "reason": { "type": "string" } },
              "required": ["ok", "reason"] }
        ] }
    });
    let generated = mostra_host_codegen::generate(&bundle(&constant)).unwrap();
    assert!(generated.wire.contains("ok: crate::wire::ConstTrue"));
    assert!(generated.wire.contains("ok: crate::wire::ConstFalse"));
}
