import {
  COACH_LOCAL_NOT_AVAILABLE,
  sendCoachPromptLocal,
} from '@/lib/services/coach-local';

describe('coach-local / sendCoachPromptLocal', () => {
  it('throws the COACH_LOCAL_NOT_AVAILABLE sentinel', async () => {
    await expect(
      sendCoachPromptLocal([{ role: 'user', content: 'hi' }])
    ).rejects.toMatchObject({
      domain: 'ml',
      code: COACH_LOCAL_NOT_AVAILABLE,
      retryable: false,
    });
  });

  it('exposes a stable error code string', () => {
    expect(COACH_LOCAL_NOT_AVAILABLE).toBe('COACH_LOCAL_NOT_AVAILABLE');
  });
});
