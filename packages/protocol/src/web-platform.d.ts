// The web-platform classes the serializer reads and writes (`FormData`, `Blob`, `File`) and
// `queueMicrotask`, present in browsers, workers and Node.js. Declared here, as far as the
// serializer uses them, so the package compiles without DOM or Node types.
declare global {
  interface Blob {
    readonly size: number;
    readonly type: string;
    arrayBuffer(): Promise<ArrayBuffer>;
  }
  var Blob: {
    prototype: Blob;
    new (parts?: readonly unknown[], options?: { type?: string }): Blob;
  };
  interface File extends Blob {
    readonly name: string;
    readonly lastModified: number;
  }
  var File: {
    prototype: File;
    new (
      parts: readonly unknown[],
      name: string,
      options?: { type?: string; lastModified?: number },
    ): File;
  };
  interface FormData {
    append(name: string, value: string | Blob, filename?: string): void;
    entries(): IterableIterator<[string, string | File]>;
  }
  var FormData: { prototype: FormData; new (): FormData };
  function queueMicrotask(callback: () => void): void;
}

export {};
