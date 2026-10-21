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
        .with_map_type("::std::collections::BTreeMap");
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
