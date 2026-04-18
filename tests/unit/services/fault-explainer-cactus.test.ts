import {
  createCactusFaultExplainer,
  isCactusAvailable,
  CactusNotInstalledError,
  type CactusOptions,
} from '@/lib/services/fault-explainer-cactus';
import type { FaultExplainer, FaultSynthesisInput } from '@/lib/services/fault-explainer';

const baseInput: FaultSynthesisInput = {
  exerciseId: 'squat',
  faultIds: ['forward-lean', 'knee-cave'],
};

describe('createCactusFaultExplainer', () => {
  it('returns an object with a synthesize method', () => {
    const runner = createCactusFaultExplainer();
    expect(runner).toBeDefined();
    expect(typeof runner.synthesize).toBe('function');
  });

  it('conforms to the FaultExplainer interface (compile-time assertion)', () => {
    // Type-level check: assigning to FaultExplainer must not produce a TS error.
    const runner: FaultExplainer = createCactusFaultExplainer();
    expect(runner).toBeDefined();
  });

  it('synthesize rejects with CactusNotInstalledError', async () => {
    const runner = createCactusFaultExplainer();
    await expect(runner.synthesize(baseInput)).rejects.toThrow(CactusNotInstalledError);
  });

  it('error message references the decision doc', async () => {
    const runner = createCactusFaultExplainer();
    let caught: unknown;
    try {
      await runner.synthesize(baseInput);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CactusNotInstalledError);
    const msg = (caught as CactusNotInstalledError).message;
    expect(msg).toMatch(/GEMMA_RUNTIME_DECISION\.md/);
    expect(msg).toMatch(/phase-1/i);
  });

  it('runner constructed with options still throws CactusNotInstalledError', async () => {
    const opts: CactusOptions = {
      modelPath: '/tmp/gemma-3n.gguf',
      maxTokens: 128,
      temperature: 0.2,
      confidenceThreshold: 0.6,
    };
    const runner = createCactusFaultExplainer(opts);
    await expect(runner.synthesize(baseInput)).rejects.toThrow(CactusNotInstalledError);
  });

  it('runner constructed with no options throws CactusNotInstalledError for empty fault list', async () => {
    const runner = createCactusFaultExplainer();
    const emptyInput: FaultSynthesisInput = { exerciseId: 'deadlift', faultIds: [] };
    await expect(runner.synthesize(emptyInput)).rejects.toThrow(CactusNotInstalledError);
  });
});

describe('isCactusAvailable', () => {
  it('resolves to false (native module not yet installed)', async () => {
    const available = await isCactusAvailable();
    expect(available).toBe(false);
  });
});

describe('CactusNotInstalledError', () => {
  it('is an instance of Error', () => {
    const err = new CactusNotInstalledError();
    expect(err).toBeInstanceOf(Error);
  });

  it('has name CactusNotInstalledError', () => {
    const err = new CactusNotInstalledError();
    expect(err.name).toBe('CactusNotInstalledError');
  });

  it('accepts a custom message', () => {
    const err = new CactusNotInstalledError('custom message');
    expect(err.message).toBe('custom message');
  });
});
