"use client";

/**
 * A data table on TanStack Table 9 in the page's theme (D26, D48): rows an agent has, with columns
 * it names, sorting by any column a person clicks, an optional search across every column, and
 * pages when there are many rows. It reads the theme's surfaces, rules and text, and announces its
 * sort order (`aria-sort`). For a table that needs more (grouping, row selection saved as a field,
 * virtual scrolling), TanStack Table itself is one import away. Takes `className`; `mostra add
 * mostra-data-table` copies it (D68).
 */

import {
  columnFilteringFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  FlexRender,
  filterFns,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { cn } from "cn";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";

/** A row: one record, its fields by name. */
export type DataRow = Readonly<Record<string, unknown>>;

/** One column of a {@link DataTable}. */
export interface DataColumn<Row extends DataRow = DataRow> {
  /** The field each row shows in it (`"amount"`). */
  readonly key: keyof Row & string;
  /** Its heading; default the key. */
  readonly header?: React.ReactNode;
  /** How a value shows; default as text. */
  readonly cell?: (value: Row[keyof Row & string], row: Row) => React.ReactNode;
  /** Right-aligned, for numbers. Default when the first row's value is a number. */
  readonly align?: "left" | "right";
  /** Whether a person can sort by it. Default true. */
  readonly sortable?: boolean;
}

/** {@link DataTable}'s props. */
export interface DataTableProps<Row extends DataRow>
  extends Omit<React.ComponentProps<"div">, "children"> {
  /** The rows. */
  readonly data: readonly Row[];
  /** The columns, in order. Default every field of the first row. */
  readonly columns?: readonly DataColumn<Row>[];
  /** What the table is, for screen readers and above it. */
  readonly caption?: React.ReactNode;
  /** A search field above the table that filters rows by any column. Default false. */
  readonly search?: boolean | string;
  /** Rows per page; default every row on one page. */
  readonly pageSize?: number;
  /** What an empty table says. */
  readonly empty?: React.ReactNode;
}

const features = tableFeatures({
  rowSortingFeature,
  columnFilteringFeature,
  globalFilteringFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns,
  filterFns,
});

/**
 * A table of rows, sortable by every column, searchable and paged when asked.
 *
 * ```tsx
 * <DataTable caption="Open invoices" data={invoices} search pageSize={20} columns={[{ key: "customer", header: "Customer" }, { key: "amount", header: "Amount", cell: (v) => euros.format(Number(v)) }]} />
 * ```
 */
export function DataTable<Row extends DataRow>({
  data,
  columns: columnsProp,
  caption,
  search = false,
  pageSize,
  empty = "Nothing to show.",
  className,
  ...props
}: DataTableProps<Row>): React.JSX.Element {
  const first = data[0];
  const columns = React.useMemo(() => {
    const given: readonly DataColumn<Row>[] =
      columnsProp ??
      (first ? (Object.keys(first) as (keyof Row & string)[]).map((key) => ({ key })) : []);
    return given.map((column) => ({
      id: column.key,
      accessorFn: (row: Row) => row[column.key],
      header: () => column.header ?? column.key,
      cell: (info: { getValue: () => unknown; row: { original: Row } }) =>
        column.cell
          ? column.cell(info.getValue() as Row[keyof Row & string], info.row.original)
          : formatted(info.getValue()),
      enableSorting: column.sortable ?? true,
      meta: {
        align: column.align ?? (typeof first?.[column.key] === "number" ? "right" : "left"),
      },
    }));
  }, [columnsProp, first]);
  const table = useTable({
    features,
    columns: columns as never,
    data: data as Row[],
    ...(pageSize !== undefined
      ? { initialState: { pagination: { pageIndex: 0, pageSize } } }
      : { initialState: { pagination: { pageIndex: 0, pageSize: Math.max(1, data.length) } } }),
  });
  const searchId = React.useId();
  const rows = table.getRowModel().rows;
  const pages = table.getPageCount();
  const state = table.state as {
    readonly globalFilter?: string;
    readonly pagination?: { readonly pageIndex: number };
  };
  return (
    <div
      data-slot="data-table"
      className={cn("flex min-w-0 flex-col gap-3 text-sm text-card-foreground", className)}
      {...props}
    >
      {search !== false && (
        // The search is the table's passing state, not an answer: verify doesn't ask it to save.
        <label htmlFor={searchId} data-mostra-transient="" className="flex max-w-xs flex-col gap-1">
          <span className="sr-only">
            {typeof search === "string" ? search : "Search the table"}
          </span>
          <input
            id={searchId}
            type="search"
            value={state.globalFilter ?? ""}
            onChange={(event) => table.setGlobalFilter(event.target.value)}
            placeholder={typeof search === "string" ? search : "Search"}
            className="h-(--control-h) rounded-control bg-(--field) px-3 text-sm shadow-(--control-shadow) outline-hidden placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
      )}
      <div className="overflow-x-auto rounded-card shadow-card">
        <table className="w-full border-collapse bg-card">
          {caption !== undefined && (
            <caption className="px-3 pt-3 pb-1 text-left font-medium text-foreground">
              {caption}
            </caption>
          )}
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} className="border-b border-border">
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  const align = (header.column.columnDef.meta as { align?: string } | undefined)
                    ?.align;
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={
                        sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"
                      }
                      className={cn(
                        "px-3 py-2 font-medium text-muted-foreground",
                        align === "right" ? "text-right" : "text-left",
                      )}
                    >
                      {header.column.getCanSort() ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-sm outline-hidden hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                            align === "right" && "flex-row-reverse",
                          )}
                        >
                          <FlexRender header={header} />
                          {sorted === "asc" ? (
                            <ArrowUp aria-hidden className="size-3.5" />
                          ) : sorted === "desc" ? (
                            <ArrowDown aria-hidden className="size-3.5" />
                          ) : (
                            <ArrowUpDown aria-hidden className="size-3.5 opacity-50" />
                          )}
                        </button>
                      ) : (
                        <FlexRender header={header} />
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={Math.max(1, columns.length)}
                  className="px-3 py-6 text-center text-muted-foreground"
                >
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  {row.getAllCells().map((cell) => {
                    const align = (cell.column.columnDef.meta as { align?: string } | undefined)
                      ?.align;
                    return (
                      <td
                        key={cell.id}
                        className={cn(
                          "px-3 py-2",
                          align === "right" ? "text-right tabular-nums" : "text-left",
                        )}
                      >
                        <FlexRender cell={cell} />
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {pageSize !== undefined && pages > 1 && (
        <nav
          aria-label="Pages"
          className="flex items-center justify-end gap-2 text-muted-foreground"
        >
          <span>
            Page {(state.pagination?.pageIndex ?? 0) + 1} of {pages}
          </span>
          <button
            type="button"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label="Previous page"
            className="inline-flex size-8 items-center justify-center rounded-button shadow-(--control-shadow) hover:text-foreground disabled:opacity-40"
          >
            <ChevronLeft aria-hidden className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            aria-label="Next page"
            className="inline-flex size-8 items-center justify-center rounded-button shadow-(--control-shadow) hover:text-foreground disabled:opacity-40"
          >
            <ChevronRight aria-hidden className="size-4" />
          </button>
        </nav>
      )}
    </div>
  );
}

/** A value as a table shows it: numbers grouped, dates as dates, nothing as a dash. */
function formatted(value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === "") return "–";
  if (typeof value === "number") return value.toLocaleString();
  if (value instanceof Date) return value.toLocaleDateString();
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
