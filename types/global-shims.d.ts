declare module 'web-streams-polyfill/ponyfill' {
  export const ReadableStream: any;
  export const WritableStream: any;
  export const TransformStream: any;
}

declare module 'text-encoding' {
  export class TextEncoder {
    encode(input?: string): Uint8Array;
  }
  export class TextDecoder {
    constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
    decode(input?: ArrayBuffer | ArrayBufferView): string;
  }
}

declare module 'expo-router/entry';

// Some community libs reference global `require` at runtime; define for TS
declare var require: any;
