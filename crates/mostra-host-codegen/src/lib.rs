//! Generates the `mostra-host` crate's wire types and method table from `@mostra/protocol`'s
//! draft-07 schema bundle (D59, D143 item 3).
//!
//! The pipeline:
//! 1. **The subset gate.** typify is Draft-7-centric, so the schema must stay inside the keywords
//!    it handles: anything else (`prefixItems`, `$dynamicRef`, `if`, `not`, external references, an
//!    unknown format) fails generation, and with it CI, naming the path.
//! 2. **Strings for times.** `date-time` and `date` values stay the strings the instance sent, so a
//!    host stores and forwards them byte for byte.
//! 3. **typify 0.8** turns every definition into a serde type.
//! 4. **Open enums.** Within a revision the protocol may add enum values and union members (HO-07),
//!    so every enum gains an `Unknown` variant that holds what this release doesn't know and
//!    serializes it back unchanged: a newer instance never breaks an older host.
//! 5. **The method table** from `x-mostra-methods` and `x-mostra-notifications`: one type per
//!    method naming its params and result.

use std::collections::BTreeSet;
use std::fmt::Write as _;

use proc_macro2::TokenStream;
use quote::{format_ident, quote};
use serde_json::{Map, Value};
use syn::visit_mut::VisitMut;

/// The schema bundle, relative to the workspace root.
pub const SCHEMA: &str = "packages/protocol/schemas/protocol.draft-07.json";
/// The generated wire types, relative to the workspace root.
pub const WIRE_OUT: &str = "crates/mostra-host/src/wire/generated.rs";
/// The generated method table, relative to the workspace root.
pub const METHODS_OUT: &str = "crates/mostra-host/src/wire/methods.rs";

/// The two generated files' text.
#[derive(Debug)]
pub struct Generated {
    /// `wire/generated.rs`.
    pub wire: String,
    /// `wire/methods.rs`.
    pub methods: String,
}

/// Keywords the generator accepts: what typify handles faithfully for Mostra's schemas.
const ALLOWED: &[&str] = &[
    "type",
    "$ref",
    "properties",
    "required",
    "description",
    "title",
    "readOnly",
    "default",
    "$comment",
    "items",
    "additionalItems",
    "minItems",
    "maxItems",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "pattern",
    "minLength",
    "maxLength",
    "format",
    "allOf",
    "anyOf",
    "oneOf",
    "enum",
    "const",
    "propertyNames",
    "additionalProperties",
];

/// Formats the generator accepts; `date-time` and `date` become plain strings.
const FORMATS: &[&str] = &["date-time", "date", "uri"];

/// Generates both files from the bundle's text.
///
/// # Errors
///
/// Every place the schema leaves the subset typify handles, or a typify failure.
pub fn generate(schema_text: &str) -> Result<Generated, String> {
    let mut bundle: Value =
        serde_json::from_str(schema_text).map_err(|e| format!("the schema isn't JSON: {e}"))?;
    let definitions = bundle
        .get_mut("definitions")
        .and_then(Value::as_object_mut)
        .ok_or("the schema has no `definitions`")?;
    let mut problems = Vec::new();
    for (name, schema) in definitions.iter() {
        check_subset(schema, &format!("definitions.{name}"), &mut problems);
    }
    if !problems.is_empty() {
        return Err(format!(
            "the schema leaves the subset typify handles (D143):\n  {}",
            problems.join("\n  ")
        ));
    }
    for schema in definitions.values_mut() {
        strip_time_formats(schema);
        boolean_constants(schema);
    }
    // typify keeps a boolean `const` as a plain `bool`, so an untagged union told apart only by one
    // (`{accepted: true}` against `{accepted: false, reason, retry}`) would decode every value as
    // its first member and drop the rest (Opus review of WP-12, finding 1). Each boolean constant is
    // a type of its own that reads only its value, and a union serde could still mis-decode fails
    // the generator.
    definitions.insert(
        CONST_TRUE.into(),
        serde_json::json!({ "type": "boolean", "enum": [true] }),
    );
    definitions.insert(
        CONST_FALSE.into(),
        serde_json::json!({ "type": "boolean", "enum": [false] }),
    );
    let ambiguous = ambiguous_unions(definitions);
    if !ambiguous.is_empty() {
        return Err(format!(
            "untagged unions serde would decode as the wrong member (D143):\n  {}",
            ambiguous.join("\n  ")
        ));
    }
    let revisions = bundle
        .get("x-mostra-revisions")
        .cloned()
        .unwrap_or(Value::Null);
    let methods = bundle
        .get("x-mostra-methods")
        .and_then(Value::as_object)
        .cloned()
        .ok_or("the schema has no `x-mostra-methods`")?;
    let notifications = bundle
        .get("x-mostra-notifications")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let root = serde_json::json!({
        "$schema": "http://json-schema.org/draft-07/schema#",
        "definitions": bundle["definitions"].clone(),
    });
    let root: schemars::schema::RootSchema =
        serde_json::from_value(root).map_err(|e| format!("schemars can't read the schema: {e}"))?;

    let mut settings = typify::TypeSpaceSettings::default();
    settings
        .with_struct_builder(false)
        .with_map_type("::std::collections::BTreeMap")
        .with_replacement(CONST_TRUE, "crate::wire::ConstTrue", std::iter::empty())
        .with_replacement(CONST_FALSE, "crate::wire::ConstFalse", std::iter::empty());
    let mut space = typify::TypeSpace::new(&settings);
    space
        .add_root_schema(root)
        .map_err(|e| format!("typify: {e}"))?;
    let mut file: syn::File = syn::parse2(space.to_stream())
        .map_err(|e| format!("typify's output doesn't parse: {e}"))?;
    open_enums(&mut file);
    let header = header(&revisions);
    let wire = format!("{header}{}", prettyplease::unparse(&file));

    let defined: BTreeSet<String> = bundle["definitions"]
        .as_object()
        .map(|defs| defs.keys().cloned().collect())
        .unwrap_or_default();
    let methods_file: syn::File = syn::parse2(method_table(&methods, &notifications, &defined)?)
        .map_err(|e| format!("the method table doesn't parse: {e}"))?;
    let methods = format!("{header}{}", prettyplease::unparse(&methods_file));
    Ok(Generated { wire, methods })
}

fn header(revisions: &Value) -> String {
    let mut text = String::from(
        "// @generated by mostra-host-codegen from packages/protocol/schemas/protocol.draft-07.json.\n\
         // Do not edit: run `cargo run -p mostra-host-codegen -- write` after the schema changes.\n",
    );
    if let Some(revisions) = revisions.as_object() {
        for (surface, revision) in revisions {
            let _ = writeln!(
                text,
                "// {surface} revision {}",
                revision.as_str().unwrap_or("?")
            );
        }
    }
    text.push('\n');
    text
}

/// Lists every keyword, format or reference outside the subset.
fn check_subset(schema: &Value, path: &str, problems: &mut Vec<String>) {
    let Value::Object(node) = schema else {
        if !schema.is_boolean() {
            problems.push(format!("{path}: a schema must be an object or a boolean"));
        }
        return;
    };
    for (key, value) in node {
        let at = format!("{path}.{key}");
        if !ALLOWED.contains(&key.as_str()) {
            problems.push(format!("{at}: the keyword `{key}` isn't in the subset"));
            continue;
        }
        match key.as_str() {
            "properties" => {
                if let Some(properties) = value.as_object() {
                    for (name, property) in properties {
                        check_subset(property, &format!("{at}.{name}"), problems);
                    }
                }
            }
            "items" | "additionalItems" | "propertyNames" | "additionalProperties" => {
                if let Some(items) = value.as_array() {
                    for (index, item) in items.iter().enumerate() {
                        check_subset(item, &format!("{at}[{index}]"), problems);
                    }
                } else {
                    check_subset(value, &at, problems);
                }
            }
            "allOf" | "anyOf" | "oneOf" => {
                for (index, item) in value.as_array().into_iter().flatten().enumerate() {
                    check_subset(item, &format!("{at}[{index}]"), problems);
                }
            }
            "$ref" => {
                if !value
                    .as_str()
                    .is_some_and(|r| r.starts_with("#/definitions/"))
                {
                    problems.push(format!(
                        "{at}: only `#/definitions/…` references are handled"
                    ));
                }
            }
            "format" if !value.as_str().is_some_and(|f| FORMATS.contains(&f)) => {
                problems.push(format!("{at}: the format {value} isn't handled"));
            }
            _ => {}
        }
    }
}

/// The synthetic definitions boolean constants become, replaced by `wire::ConstTrue` and
/// `wire::ConstFalse`.
const CONST_TRUE: &str = "MostraConstTrue";
const CONST_FALSE: &str = "MostraConstFalse";

/// Replaces every `{ "type": "boolean", "const": b }` with a reference to its constant's type.
fn boolean_constants(schema: &mut Value) {
    match schema {
        Value::Object(node) => {
            if let Some(Value::Bool(value)) = node.get("const") {
                let target = if *value { CONST_TRUE } else { CONST_FALSE };
                *schema = serde_json::json!({ "$ref": format!("#/definitions/{target}") });
                return;
            }
            for (key, value) in node.iter_mut() {
                if key != "enum" && key != "default" {
                    boolean_constants(value);
                }
            }
        }
        Value::Array(items) => items.iter_mut().for_each(boolean_constants),
        _ => {}
    }
}

/// Every `anyOf` or `oneOf` whose object members serde, trying them in order and ignoring unknown
/// fields, would decode as an earlier member: a value of the later member then loses its fields.
/// Unions typify tags (every member an object with one shared string constant) are skipped.
fn ambiguous_unions(definitions: &serde_json::Map<String, Value>) -> Vec<String> {
    let mut found = Vec::new();
    for (name, schema) in definitions {
        walk_unions(
            schema,
            &format!("definitions.{name}"),
            definitions,
            &mut found,
        );
    }
    found
}

fn walk_unions(
    schema: &Value,
    path: &str,
    defs: &serde_json::Map<String, Value>,
    found: &mut Vec<String>,
) {
    let Value::Object(node) = schema else { return };
    for (key, value) in node {
        let at = format!("{path}.{key}");
        match key.as_str() {
            "anyOf" | "oneOf" => {
                let members: Vec<&Value> = value.as_array().into_iter().flatten().collect();
                if !tagged(&members, defs) {
                    for (j, later) in members.iter().enumerate() {
                        let later = resolve(later, defs);
                        if !is_object(later) {
                            continue;
                        }
                        let probe = minimal(later, defs, 0);
                        for (i, earlier) in members.iter().enumerate().take(j) {
                            if accepts(resolve(earlier, defs), &probe, defs, 0) {
                                found.push(format!(
                                    "{at}: member {j} ({probe}) decodes as member {i}"
                                ));
                            }
                        }
                    }
                }
                for (index, member) in members.iter().enumerate() {
                    walk_unions(member, &format!("{at}[{index}]"), defs, found);
                }
            }
            "properties" => {
                for (name, property) in value.as_object().into_iter().flatten() {
                    walk_unions(property, &format!("{at}.{name}"), defs, found);
                }
            }
            "items" | "additionalProperties" | "allOf" => match value {
                Value::Array(items) => {
                    for (index, item) in items.iter().enumerate() {
                        walk_unions(item, &format!("{at}[{index}]"), defs, found);
                    }
                }
                other => walk_unions(other, &at, defs, found),
            },
            _ => {}
        }
    }
}

fn resolve<'a>(schema: &'a Value, defs: &'a serde_json::Map<String, Value>) -> &'a Value {
    let mut current = schema;
    for _ in 0..32 {
        let Some(name) = current
            .get("$ref")
            .and_then(Value::as_str)
            .and_then(|r| r.strip_prefix("#/definitions/"))
        else {
            break;
        };
        match defs.get(name) {
            Some(next) => current = next,
            None => break,
        }
    }
    current
}

fn is_object(schema: &Value) -> bool {
    schema.get("type").and_then(Value::as_str) == Some("object")
        || (schema.get("type").is_none() && schema.get("properties").is_some())
}

/// The string constant a member fixes for `property`, if it does.
fn string_constant<'a>(schema: &'a Value, property: &str) -> Option<&'a str> {
    let value = schema.get("properties")?.get(property)?;
    value.get("const").and_then(Value::as_str).or_else(|| {
        match value
            .get("enum")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
        {
            Some([only]) => only.as_str(),
            _ => None,
        }
    })
}

/// Whether typify tags this union: every member an object sharing a property that each fixes to
/// a distinct string.
fn tagged(members: &[&Value], defs: &serde_json::Map<String, Value>) -> bool {
    let resolved: Vec<&Value> = members.iter().map(|m| resolve(m, defs)).collect();
    if resolved.len() < 2 || !resolved.iter().all(|m| is_object(m)) {
        return false;
    }
    let Some(first) = resolved[0].get("properties").and_then(Value::as_object) else {
        return false;
    };
    first.keys().any(|property| {
        let tags: Vec<Option<&str>> = resolved
            .iter()
            .map(|m| string_constant(m, property))
            .collect();
        tags.iter().all(Option::is_some) && tags.iter().collect::<BTreeSet<_>>().len() == tags.len()
    })
}

/// The smallest value a member describes: its required properties, each at its smallest.
fn minimal(schema: &Value, defs: &serde_json::Map<String, Value>, depth: usize) -> Value {
    let schema = resolve(schema, defs);
    if depth > 16 {
        return Value::Null;
    }
    if let Some(value) = schema.get("const") {
        return value.clone();
    }
    if let Some(first) = schema
        .get("enum")
        .and_then(Value::as_array)
        .and_then(|e| e.first())
    {
        return first.clone();
    }
    for key in ["anyOf", "oneOf"] {
        if let Some(first) = schema
            .get(key)
            .and_then(Value::as_array)
            .and_then(|m| m.first())
        {
            return minimal(first, defs, depth + 1);
        }
    }
    match schema.get("type").and_then(Value::as_str) {
        Some("boolean") => Value::Bool(false),
        Some("integer" | "number") => Value::from(1),
        Some("string") => Value::from("x"),
        Some("array") => Value::Array(Vec::new()),
        Some("null") => Value::Null,
        _ if is_object(schema) => {
            let mut object = serde_json::Map::new();
            for name in schema
                .get("required")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
            {
                let property = schema
                    .get("properties")
                    .and_then(|p| p.get(name))
                    .unwrap_or(&Value::Null);
                object.insert(name.to_owned(), minimal(property, defs, depth + 1));
            }
            Value::Object(object)
        }
        _ => Value::Null,
    }
}

/// Whether serde's untagged decoding of a generated type for `schema` takes `value`: the right
/// JSON kind, every required property present and taken, unknown properties ignored, a boolean
/// constant only for its value (`MostraConstTrue`/`False`), and any string for an enum (enums
/// keep an `Unknown` variant).
fn accepts(
    schema: &Value,
    value: &Value,
    defs: &serde_json::Map<String, Value>,
    depth: usize,
) -> bool {
    if depth > 16 {
        return true;
    }
    if let Some(name) = schema
        .get("$ref")
        .and_then(Value::as_str)
        .and_then(|r| r.strip_prefix("#/definitions/"))
    {
        if name == CONST_TRUE {
            return value == &Value::Bool(true);
        }
        if name == CONST_FALSE {
            return value == &Value::Bool(false);
        }
    }
    let schema = resolve(schema, defs);
    for key in ["anyOf", "oneOf"] {
        if let Some(members) = schema.get(key).and_then(Value::as_array) {
            return members.iter().any(|m| accepts(m, value, defs, depth + 1));
        }
    }
    match schema.get("type").and_then(Value::as_str) {
        Some("boolean") => value.is_boolean(),
        Some("integer") => value.is_i64() || value.is_u64(),
        Some("number") => value.is_number(),
        Some("string") => value.is_string(),
        Some("array") => value.is_array(),
        Some("null") => value.is_null(),
        _ if is_object(schema) => {
            let Some(object) = value.as_object() else {
                return false;
            };
            schema
                .get("required")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .all(|name| {
                    object.get(name).is_some_and(|field| {
                        schema
                            .get("properties")
                            .and_then(|p| p.get(name))
                            .is_none_or(|property| accepts(property, field, defs, depth + 1))
                    })
                })
        }
        _ => true,
    }
}

/// Removes `date-time` and `date` formats, so times stay the strings the instance sent.
fn strip_time_formats(schema: &mut Value) {
    match schema {
        Value::Object(node) => {
            let is_time = node
                .get("format")
                .and_then(Value::as_str)
                .is_some_and(|f| f == "date-time" || f == "date");
            if is_time {
                node.remove("format");
            }
            for (key, value) in node.iter_mut() {
                if key != "enum" && key != "const" && key != "default" {
                    strip_time_formats(value);
                }
            }
        }
        Value::Array(items) => items.iter_mut().for_each(strip_time_formats),
        _ => {}
    }
}

/// One enum's shape, for the open-enum pass.
struct EnumShape {
    name: String,
    /// `(variant, wire value)` when every variant is a unit; `None` for enums with data.
    units: Option<Vec<(syn::Ident, String)>>,
}

/// Gives every enum an `Unknown` variant and drops `Copy` everywhere (an open enum holds data).
fn open_enums(file: &mut syn::File) {
    let mut shapes = Vec::new();
    collect_enums(&mut file.items, &mut shapes);
    let names: BTreeSet<String> = shapes
        .iter()
        .filter(|shape| shape.units.is_some())
        .map(|shape| shape.name.clone())
        .collect();
    // typify's Display and FromStr of a string enum reject unknown values: replaced below.
    file.items.retain(|item| {
        let syn::Item::Impl(implementation) = item else {
            return true;
        };
        let Some((trait_path, _)) = &implementation.trait_ else {
            return true;
        };
        let trait_name = trait_path
            .segments
            .last()
            .map(|s| s.ident.to_string())
            .unwrap_or_default();
        let self_name = match implementation.self_ty.as_ref() {
            syn::Type::Path(path) => path
                .path
                .segments
                .last()
                .map(|s| s.ident.to_string())
                .unwrap_or_default(),
            _ => String::new(),
        };
        !(names.contains(&self_name) && (trait_name == "Display" || trait_name == "FromStr"))
    });
    for shape in &shapes {
        if let Some(units) = &shape.units {
            file.items.extend(string_enum_impls(&shape.name, units));
        }
    }
    // typify's Display of an enum with data matches every variant: the new one prints its JSON.
    let data: BTreeSet<String> = shapes
        .iter()
        .filter(|shape| shape.units.is_none())
        .map(|shape| shape.name.clone())
        .collect();
    for item in &mut file.items {
        let syn::Item::Impl(implementation) = item else {
            continue;
        };
        let is_display = implementation
            .trait_
            .as_ref()
            .is_some_and(|(path, _)| path.segments.last().is_some_and(|s| s.ident == "Display"));
        let self_name = match implementation.self_ty.as_ref() {
            syn::Type::Path(path) => path
                .path
                .segments
                .last()
                .map(|s| s.ident.to_string())
                .unwrap_or_default(),
            _ => String::new(),
        };
        if is_display && data.contains(&self_name) {
            UnknownArm.visit_item_impl_mut(implementation);
        }
    }
    NoCopy.visit_file_mut(file);
}

/// Adds `Self::Unknown(value) => value.fmt(f)` to every `match` of a Display impl.
struct UnknownArm;

impl VisitMut for UnknownArm {
    fn visit_expr_match_mut(&mut self, node: &mut syn::ExprMatch) {
        node.arms
            .push(syn::parse_quote!(Self::Unknown(value) => value.fmt(f),));
    }
}

/// Drops `Copy` from every derive: an open enum holds a `String` or a JSON value.
struct NoCopy;

impl VisitMut for NoCopy {
    fn visit_attribute_mut(&mut self, attribute: &mut syn::Attribute) {
        if !attribute.path().is_ident("derive") {
            return;
        }
        if let Ok(list) = attribute.parse_args_with(
            syn::punctuated::Punctuated::<syn::Path, syn::Token![,]>::parse_terminated,
        ) {
            let kept: Vec<syn::Path> = list
                .into_iter()
                .filter(|path| !path.is_ident("Copy"))
                .collect();
            *attribute = syn::parse_quote!(#[derive(#(#kept),*)]);
        }
    }
}

fn collect_enums(items: &mut [syn::Item], shapes: &mut Vec<EnumShape>) {
    for item in items {
        match item {
            syn::Item::Enum(definition) => {
                let untagged = definition.attrs.iter().any(|attribute| {
                    attribute.path().is_ident("serde")
                        && quote!(#attribute).to_string().contains("untagged")
                });
                let units = definition
                    .variants
                    .iter()
                    .all(|variant| matches!(variant.fields, syn::Fields::Unit))
                    .then(|| {
                        definition
                            .variants
                            .iter()
                            .map(|variant| (variant.ident.clone(), wire_name(variant)))
                            .collect::<Vec<_>>()
                    });
                let unknown: syn::Variant = if units.is_some() {
                    syn::parse_quote! {
                        /// A value a newer Mostra sends that this release doesn't know; it
                        /// serializes back unchanged.
                        #[serde(untagged)]
                        Unknown(::std::string::String)
                    }
                } else if untagged {
                    syn::parse_quote! {
                        /// A value a newer Mostra sends that this release doesn't know; it
                        /// serializes back unchanged.
                        Unknown(::serde_json::Value)
                    }
                } else {
                    syn::parse_quote! {
                        /// A value a newer Mostra sends that this release doesn't know; it
                        /// serializes back unchanged.
                        #[serde(untagged)]
                        Unknown(::serde_json::Value)
                    }
                };
                definition.variants.push(unknown);
                shapes.push(EnumShape {
                    name: definition.ident.to_string(),
                    units,
                });
            }
            syn::Item::Mod(module) => {
                if let Some((_, items)) = &mut module.content {
                    collect_enums(items, shapes);
                }
            }
            _ => {}
        }
    }
}

/// A unit variant's value on the wire: its `#[serde(rename = "…")]`, else its name.
fn wire_name(variant: &syn::Variant) -> String {
    for attribute in &variant.attrs {
        if !attribute.path().is_ident("serde") {
            continue;
        }
        let mut renamed = None;
        let _ = attribute.parse_nested_meta(|meta| {
            if meta.path.is_ident("rename") {
                let value: syn::LitStr = meta.value()?.parse()?;
                renamed = Some(value.value());
            }
            Ok(())
        });
        if let Some(name) = renamed {
            return name;
        }
    }
    variant.ident.to_string()
}

fn string_enum_impls(name: &str, units: &[(syn::Ident, String)]) -> Vec<syn::Item> {
    let ty = format_ident!("{name}");
    let idents: Vec<&syn::Ident> = units.iter().map(|(ident, _)| ident).collect();
    let values: Vec<&String> = units.iter().map(|(_, value)| value).collect();
    let file: syn::File = syn::parse_quote! {
        impl #ty {
            /// The value as it travels on the wire.
            #[must_use]
            pub fn as_str(&self) -> &str {
                match self {
                    #(Self::#idents => #values,)*
                    Self::Unknown(value) => value.as_str(),
                }
            }
        }
        impl ::std::fmt::Display for #ty {
            fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
                f.write_str(self.as_str())
            }
        }
        impl ::std::str::FromStr for #ty {
            type Err = self::error::ConversionError;
            fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
                Ok(match value {
                    #(#values => Self::#idents,)*
                    other => Self::Unknown(other.to_string()),
                })
            }
        }
    };
    file.items
}

/// `artifact/publish` → `ArtifactPublish`; `port/trustedControls.policy` → `PortTrustedControlsPolicy`.
fn method_type(method: &str) -> syn::Ident {
    let mut name = String::new();
    for part in method.split(['/', '.']) {
        let mut chars = part.chars();
        if let Some(first) = chars.next() {
            name.extend(first.to_uppercase());
            name.push_str(chars.as_str());
        }
    }
    format_ident!("{name}")
}

/// The Rust type of a method's params or result: its definition, or JSON for `{}`.
fn schema_type(
    schema: &Value,
    defined: &BTreeSet<String>,
    what: &str,
) -> Result<TokenStream, String> {
    match schema.get("$ref").and_then(Value::as_str) {
        Some(reference) => {
            let name = reference
                .strip_prefix("#/definitions/")
                .ok_or_else(|| format!("{what}: {reference} isn't a local definition"))?;
            if !defined.contains(name) {
                return Err(format!("{what}: no definition {name}"));
            }
            let ident = format_ident!("{name}");
            Ok(quote!(super::generated::#ident))
        }
        None if schema.as_object().is_some_and(Map::is_empty) => Ok(quote!(::serde_json::Value)),
        None => Err(format!("{what}: expected a reference or `{{}}`")),
    }
}

fn method_table(
    methods: &Map<String, Value>,
    notifications: &Map<String, Value>,
    defined: &BTreeSet<String>,
) -> Result<TokenStream, String> {
    let mut items = Vec::new();
    let mut infos = Vec::new();
    for (name, entry) in methods {
        let ty = method_type(name);
        let direction = match entry.get("direction").and_then(Value::as_str) {
            Some("client-to-instance") => quote!(super::Direction::ClientToInstance),
            Some("instance-to-host") => quote!(super::Direction::InstanceToHost),
            other => return Err(format!("{name}: unknown direction {other:?}")),
        };
        let mutating = entry
            .get("mutating")
            .and_then(Value::as_bool)
            .ok_or_else(|| format!("{name}: no `mutating`"))?;
        let params = schema_type(&entry["params"], defined, &format!("{name} params"))?;
        let result = schema_type(&entry["result"], defined, &format!("{name} result"))?;
        let doc = format!("`{name}`.");
        items.push(quote! {
            #[doc = #doc]
            #[derive(Clone, Copy, Debug)]
            pub struct #ty;
            impl super::Method for #ty {
                const NAME: &'static str = #name;
                const DIRECTION: super::Direction = #direction;
                const MUTATING: bool = #mutating;
                type Params = #params;
                type Result = #result;
            }
        });
        infos.push(quote! {
            super::MethodInfo { name: #name, direction: #direction, mutating: #mutating }
        });
    }
    let mut notification_names = Vec::new();
    for (name, entry) in notifications {
        let ty = method_type(name);
        let params = schema_type(&entry["params"], defined, &format!("{name} params"))?;
        let doc = format!("The notification `{name}`.");
        items.push(quote! {
            #[doc = #doc]
            #[derive(Clone, Copy, Debug)]
            pub struct #ty;
            impl super::Notification for #ty {
                const NAME: &'static str = #name;
                type Params = #params;
            }
        });
        notification_names.push(name.clone());
    }
    Ok(quote! {
        //! Every method and notification of the host protocol, as the schema lists them.
        #(#items)*
        /// Every method, in name order.
        pub const METHODS: &[super::MethodInfo] = &[#(#infos),*];
        /// Every notification's name, in name order.
        pub const NOTIFICATIONS: &[&str] = &[#(#notification_names),*];
    })
}
