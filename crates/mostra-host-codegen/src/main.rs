//! `mostra-host-codegen write|check`: regenerates `mostra-host`'s wire types and method table
//! from the protocol's draft-07 schema, or checks the committed files are current (D59, D143).

use std::path::PathBuf;
use std::process::ExitCode;

fn workspace() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("the workspace root exists")
}

fn main() -> ExitCode {
    let mode = std::env::args().nth(1).unwrap_or_default();
    if mode != "write" && mode != "check" {
        eprintln!("usage: mostra-host-codegen write|check");
        return ExitCode::from(2);
    }
    let root = workspace();
    let schema = match std::fs::read_to_string(root.join(mostra_host_codegen::SCHEMA)) {
        Ok(text) => text,
        Err(error) => {
            eprintln!("can't read {}: {error}", mostra_host_codegen::SCHEMA);
            return ExitCode::FAILURE;
        }
    };
    let generated = match mostra_host_codegen::generate(&schema) {
        Ok(generated) => generated,
        Err(error) => {
            eprintln!("{error}");
            return ExitCode::FAILURE;
        }
    };
    let mut stale = Vec::new();
    for (path, text) in [
        (mostra_host_codegen::WIRE_OUT, &generated.wire),
        (mostra_host_codegen::METHODS_OUT, &generated.methods),
    ] {
        let file = root.join(path);
        let current = std::fs::read_to_string(&file).unwrap_or_default();
        if current == *text {
            continue;
        }
        if mode == "write" {
            if let Err(error) = std::fs::write(&file, text) {
                eprintln!("can't write {path}: {error}");
                return ExitCode::FAILURE;
            }
            println!("wrote {path}");
        } else {
            stale.push(path);
        }
    }
    if !stale.is_empty() {
        eprintln!(
            "{} out of date with the schema. Run `cargo run -p mostra-host-codegen -- write`.",
            stale.join(" and ")
        );
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}
