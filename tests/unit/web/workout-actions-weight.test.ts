import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

// Run the full, unchanged server-action module. Isolate Next/Supabase only;
// the app's @ alias differs from the native Jest root alias.
const source = fs.readFileSync(path.resolve(__dirname, '../../../apps/web/lib/actions.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness(authenticated = true) {
  const writes: { table: string; value: unknown }[] = [];
  const redirect = jest.fn(() => { throw new Error('NEXT_REDIRECT'); });
  const revalidatePath = jest.fn();
  const from = jest.fn((table: string) => ({
    insert: (value: unknown) => {
      writes.push({ table, value });
      return {
        error: null,
        select: () => ({ single: async () => ({ data: { id: `${table}-id` }, error: null }) }),
      };
    },
  }));
  const supabase = { auth: { getUser: async () => ({ data: { user: authenticated ? { id: 'owner-a' } : null } }) }, from };
  const exports: { addWorkout?: (form: FormData) => Promise<void> } = {};
  vm.runInNewContext(compiled, {
    exports,
    require: (id: string) => {
      if (id === 'next/navigation') return { redirect };
      if (id === 'next/cache') return { revalidatePath };
      if (id === '@/lib/supabase/server') return { createClient: async () => supabase };
      throw new Error(`Unexpected server dependency: ${id}`);
    },
  }, { filename: 'apps/web/lib/actions.ts' });
  return { addWorkout: exports.addWorkout!, writes, from, redirect, revalidatePath };
}

function form(weight: unknown) {
  const values = new Map<string, unknown>([
    ['exercise_id', 'exercise-a'], ['exercise_name', 'Curl'], ['sets', '2'], ['reps', '8'], ['weight', weight],
  ]);
  return { get: (key: string) => values.get(key) ?? null } as FormData;
}

it.each([null, '', '   '])('keeps unspecified web workout weight %p as null, not explicit zero', async (weight) => {
  const run = harness();
  await expect(run.addWorkout(form(weight))).rejects.toThrow('NEXT_REDIRECT');
  const rows = run.writes.find(({ table }) => table === 'workout_session_sets')!.value;
  expect(rows).toEqual([
    expect.objectContaining({ actual_weight: null, actual_reps: 8 }),
    expect.objectContaining({ actual_weight: null, actual_reps: 8 }),
  ]);
  expect(run.writes[0]).toEqual({ table: 'workout_sessions', value: expect.objectContaining({ user_id: 'owner-a' }) });
  expect(run.redirect).toHaveBeenCalledWith('/workouts');
  expect(run.revalidatePath).toHaveBeenCalledWith('/workouts');
});

it.each(['-1', 'Infinity', 'NaN', '12lbs', '1.2.3', '0x10', '1e3', '9'.repeat(400), { name: 'weight.txt' }])(
  'rejects invalid web weight %p before creating any records', async (weight) => {
    const run = harness();
    await expect(run.addWorkout(form(weight))).rejects.toThrow('Weight must be a finite, non-negative number');
    expect(run.writes).toEqual([]);
    expect(run.from).not.toHaveBeenCalled();
    expect(run.revalidatePath).not.toHaveBeenCalled();
    expect(run.redirect).not.toHaveBeenCalled();
  },
);

it.each([['0', 0], ['0.0', 0], [' 45.19471 ', 45.19471], ['.5', 0.5], ['12.', 12]])(
  'preserves valid pounds input %s as %p without rounding or converting', async (input, expected) => {
    const run = harness();
    await expect(run.addWorkout(form(input))).rejects.toThrow('NEXT_REDIRECT');
    expect(run.writes.find(({ table }) => table === 'workout_session_sets')!.value).toEqual([
      expect.objectContaining({ actual_weight: expected }),
      expect.objectContaining({ actual_weight: expected }),
    ]);
  },
);

it('requires authentication before any workout write', async () => {
  const run = harness(false);
  await expect(run.addWorkout(form('20'))).rejects.toThrow('NEXT_REDIRECT');
  expect(run.redirect).toHaveBeenCalledWith('/sign-in');
  expect(run.writes).toEqual([]);
});
