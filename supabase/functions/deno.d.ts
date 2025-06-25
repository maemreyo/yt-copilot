// Type definitions for Deno environment in Supabase Edge Functions

/// <reference types="https://deno.land/x/xhr@0.3.0/mod.d.ts" />

declare global {
  const Deno: {
    env: {
      get(key: string): string | undefined;
      set(key: string, value: string): void;
      has(key: string): boolean;
      delete(key: string): void;
    };
    args: string[];
    version: {
      deno: string;
      v8: string;
      typescript: string;
    };
    build: {
      target: string;
      arch: string;
      os: string;
      vendor: string;
      env?: string;
    };
    errors: {
      NotFound: new () => Error;
      PermissionDenied: new () => Error;
      ConnectionRefused: new () => Error;
      ConnectionReset: new () => Error;
      ConnectionAborted: new () => Error;
      NotConnected: new () => Error;
      AddrInUse: new () => Error;
      AddrNotAvailable: new () => Error;
      BrokenPipe: new () => Error;
      AlreadyExists: new () => Error;
      InvalidData: new () => Error;
      TimedOut: new () => Error;
      Interrupted: new () => Error;
      WriteZero: new () => Error;
      UnexpectedEof: new () => Error;
      BadResource: new () => Error;
      Http: new () => Error;
      Busy: new () => Error;
      NotSupported: new () => Error;
    };
  };

  // Request/Response types for Deno
  interface Request {
    readonly method: string;
    readonly url: string;
    readonly headers: Headers;
    readonly body: ReadableStream<Uint8Array> | null;
    readonly bodyUsed: boolean;
    clone(): Request;
    json(): Promise<any>;
    text(): Promise<string>;
    formData(): Promise<FormData>;
    arrayBuffer(): Promise<ArrayBuffer>;
    blob(): Promise<Blob>;
  }

  interface Response {
    readonly status: number;
    readonly statusText: string;
    readonly headers: Headers;
    readonly body: ReadableStream<Uint8Array> | null;
    readonly bodyUsed: boolean;
    readonly ok: boolean;
    readonly redirected: boolean;
    readonly type: ResponseType;
    readonly url: string;
    clone(): Response;
    json(): Promise<any>;
    text(): Promise<string>;
    formData(): Promise<FormData>;
    arrayBuffer(): Promise<ArrayBuffer>;
    blob(): Promise<Blob>;
  }

  const Response: {
    new (body?: BodyInit | null, init?: ResponseInit): Response;
    error(): Response;
    redirect(url: string | URL, status?: number): Response;
    json(data: any, init?: ResponseInit): Response;
  };

  // Headers
  interface Headers {
    append(name: string, value: string): void;
    delete(name: string): void;
    get(name: string): string | null;
    has(name: string): boolean;
    set(name: string, value: string): void;
    forEach(callbackfn: (value: string, key: string, parent: Headers) => void, thisArg?: any): void;
    keys(): IterableIterator<string>;
    values(): IterableIterator<string>;
    entries(): IterableIterator<[string, string]>;
    [Symbol.iterator](): IterableIterator<[string, string]>;
  }

  const Headers: {
    new (init?: HeadersInit): Headers;
  };

  // URL
  interface URL {
    hash: string;
    host: string;
    hostname: string;
    href: string;
    origin: string;
    password: string;
    pathname: string;
    port: string;
    protocol: string;
    search: string;
    searchParams: URLSearchParams;
    username: string;
    toString(): string;
    toJSON(): string;
  }

  const URL: {
    new (url: string | URL, base?: string | URL): URL;
    createObjectURL(object: Blob | MediaSource): string;
    revokeObjectURL(url: string): void;
  };

  // URLSearchParams
  interface URLSearchParams {
    append(name: string, value: string): void;
    delete(name: string): void;
    get(name: string): string | null;
    getAll(name: string): string[];
    has(name: string): boolean;
    set(name: string, value: string): void;
    sort(): void;
    toString(): string;
    forEach(callbackfn: (value: string, key: string, parent: URLSearchParams) => void, thisArg?: any): void;
    keys(): IterableIterator<string>;
    values(): IterableIterator<string>;
    entries(): IterableIterator<[string, string]>;
    [Symbol.iterator](): IterableIterator<[string, string]>;
  }

  const URLSearchParams: {
    new (init?: string | string[][] | Record<string, string> | URLSearchParams): URLSearchParams;
  };

  // Crypto
  interface Crypto {
    readonly subtle: SubtleCrypto;
    getRandomValues<T extends ArrayBufferView | null>(array: T): T;
    randomUUID(): string;
  }

  const crypto: Crypto;

  // Console
  interface Console {
    assert(condition?: boolean, ...data: any[]): void;
    clear(): void;
    count(label?: string): void;
    countReset(label?: string): void;
    debug(...data: any[]): void;
    dir(item?: any, options?: any): void;
    dirxml(...data: any[]): void;
    error(...data: any[]): void;
    group(...data: any[]): void;
    groupCollapsed(...data: any[]): void;
    groupEnd(): void;
    info(...data: any[]): void;
    log(...data: any[]): void;
    table(tabularData?: any, properties?: string[]): void;
    time(label?: string): void;
    timeEnd(label?: string): void;
    timeLog(label?: string, ...data: any[]): void;
    timeStamp(label?: string): void;
    trace(...data: any[]): void;
    warn(...data: any[]): void;
  }

  const console: Console;

  // Performance
  interface Performance {
    readonly timeOrigin: number;
    clearMarks(markName?: string): void;
    clearMeasures(measureName?: string): void;
    getEntries(): PerformanceEntryList;
    getEntriesByName(name: string, type?: string): PerformanceEntryList;
    getEntriesByType(type: string): PerformanceEntryList;
    mark(markName: string, markOptions?: PerformanceMarkOptions): PerformanceMark;
    measure(measureName: string, startOrMeasureOptions?: string | PerformanceMeasureOptions, endMark?: string): PerformanceMeasure;
    now(): number;
  }

  const performance: Performance;

  // Error types
  interface ErrorConstructor {
    new (message?: string): Error;
    (message?: string): Error;
    readonly prototype: Error;
    captureStackTrace?(targetObject: object, constructorOpt?: Function): void;
    prepareStackTrace?(err: Error, stackTraces: NodeJS.CallSite[]): any;
    stackTraceLimit: number;
  }

  // Supabase Edge Functions specific
  type ServeHandler = (request: Request) => Response | Promise<Response>;
  
  interface ServeOptions {
    hostname?: string;
    port?: number;
    onListen?: (params: { hostname: string; port: number }) => void;
    onError?: (error: Error) => Response | Promise<Response>;
  }
}

export {};