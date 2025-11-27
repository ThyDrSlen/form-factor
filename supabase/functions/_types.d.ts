// Ambient declarations so the app's TypeScript check can understand the Deno edge functions.
declare module 'https://deno.land/std@0.224.0/http/server.ts' {
  export function serve(
    handler: (req: Request) => Response | Promise<Response>,
    options?: { port?: number }
  ): void;
}

declare module 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno' {
  export * from '@supabase/supabase-js';
}

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};
