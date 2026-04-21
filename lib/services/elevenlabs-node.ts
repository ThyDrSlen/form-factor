/**
 * Node.js-only ElevenLabs helpers.
 *
 * Importing `node:fs` from a file that Metro pulls into the RN bundle leaves
 * the `import('node:fs')` string in main.jsbundle, which breaks Xcode's App
 * Intents metadata extractor during iOS production builds. Keep filesystem
 * writes here and never import this file from app/ui/hook code — only from
 * scripts/ and Node-only tests.
 */

import { writeFileSync } from 'node:fs';
import { generateSpeech, type ElevenLabsOptions } from './elevenlabs-service';

export async function generateCueFile(
  text: string,
  outputPath: string,
  options?: ElevenLabsOptions,
): Promise<boolean> {
  try {
    const arrayBuffer = await generateSpeech(text, options);
    if (!arrayBuffer) return false;
    writeFileSync(outputPath, Buffer.from(arrayBuffer));
    return true;
  } catch (error) {
    console.warn('[ElevenLabs] generateCueFile failed:', error);
    return false;
  }
}
