"use server";
// Server code that needs its packages where npm put them (D135): a native addon, packages that
// read files beside themselves (ESM and CommonJS), a package that renders with the one React, and
// a warm package whose version the version locked.
import * as locked from "cn";
import cjsSelf from "mostra-fixture-cjs-self";
import native from "mostra-fixture-native";
import { Counter } from "mostra-fixture-peer";
import { greeting } from "mostra-fixture-self";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

/** Files a package reads from its own directory. */
export async function ownFiles() {
  return { esm: greeting(), cjs: cjsSelf.data() };
}

/** A native addon: the binding's exports. */
export async function addon() {
  return typeof native.Database;
}

/** A package's hooks render with the version's one React. */
export async function render() {
  return renderToString(createElement(Counter));
}

/** Which copy of a warm package the version's server code runs against. */
export async function warmCopy() {
  return (locked as { mostraMarker?: string }).mostraMarker ?? "warm";
}
