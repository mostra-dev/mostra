/**
 * The chrome's drawn marks (D171): one consistent set, 16 units square, in the text's colour, never
 * a glyph or an emoji. Mostra's arcade mark takes its two colours from the theme (`--mark-left`,
 * `--mark-right`), so it is right in light and in dark.
 */
import type { ReactElement } from "react";

type IconProps = { readonly className?: string };

const svg = (path: ReactElement, props: IconProps, viewBox = "0 0 16 16"): ReactElement => (
  <svg
    viewBox={viewBox}
    aria-hidden="true"
    focusable="false"
    className={props.className ?? "mostra-icon-svg"}
  >
    {path}
  </svg>
);

export const LockIcon = (props: IconProps = {}): ReactElement =>
  svg(
    <path
      fill="currentColor"
      d="M5 7V5a3 3 0 0 1 6 0v2h.5A1.5 1.5 0 0 1 13 8.5v5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13.5v-5A1.5 1.5 0 0 1 4.5 7H5zm1.5 0h3V5a1.5 1.5 0 0 0-3 0v2z"
    />,
    props,
  );

export const FlagIcon = (props: IconProps = {}): ReactElement =>
  svg(
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3.5 14.5v-12m0 0h8l-1.8 3 1.8 3h-8"
    />,
    props,
  );

export const PersonIcon = (props: IconProps = {}): ReactElement =>
  svg(
    <>
      <circle cx="8" cy="5.5" r="2.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M2.75 14c.6-2.7 2.7-4.25 5.25-4.25S12.65 11.3 13.25 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </>,
    props,
  );

export const FoldIcon = (props: IconProps = {}): ReactElement =>
  svg(
    <path
      d="M4 10l4-4 4 4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />,
    props,
  );

export const UnfoldIcon = (props: IconProps = {}): ReactElement =>
  svg(
    <path
      d="M4 6l4 4 4-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />,
    props,
  );

export const MoonIcon = (props: IconProps = {}): ReactElement =>
  svg(<path fill="currentColor" d="M13.4 10.3A6 6 0 0 1 5.7 2.6a6 6 0 1 0 7.7 7.7z" />, props);

export const SunIcon = (props: IconProps = {}): ReactElement =>
  svg(
    <>
      <circle cx="8" cy="8" r="3" fill="currentColor" />
      <path
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1"
      />
    </>,
    props,
  );

export const CloseIcon = (props: IconProps = {}): ReactElement =>
  svg(
    <path
      d="M4 4l8 8M12 4l-8 8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />,
    props,
  );

/** A verified name's tick: a verde disc. */
export const VerifiedIcon = (props: IconProps = {}): ReactElement =>
  svg(
    <>
      <circle cx="8" cy="8" r="7" className="mostra-tick-disc" />
      <path
        d="M4.8 8.2l2.1 2.1 4.3-4.6"
        fill="none"
        className="mostra-tick-mark"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>,
    { className: props.className ?? "mostra-tick" },
  );

/** Mostra's arcade mark: two arches sharing the middle leg (HQ's geometry, 256 units). */
export const MostraMark = (props: IconProps = {}): ReactElement =>
  svg(
    <>
      <path
        className="mostra-mark-left"
        d="M21 194.15L21 122.85A61 61 0 0 1 82 61.85A61 61 0 0 1 143 122.85L143 194.15L113 194.15L113 122.85A31 31 0 0 0 82 91.85A31 31 0 0 0 51 122.85L51 194.15Z"
      />
      <path
        className="mostra-mark-right"
        d="M113 194.15L113 122.85A61 61 0 0 1 174 61.85A61 61 0 0 1 235 122.85L235 194.15L205 194.15L205 122.85A31 31 0 0 0 174 91.85A31 31 0 0 0 143 122.85L143 194.15Z"
      />
    </>,
    { className: props.className ?? "mostra-mark-svg" },
    "0 0 256 256",
  );
