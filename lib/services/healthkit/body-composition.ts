import { getNativeHealthKit } from './native-healthkit';

export type BodyFatReading = { date: number; value: number };

/** User-initiated only: requests optional body-fat read access, never writes HealthKit. */
export async function readBodyFatHistory(now = new Date()): Promise<BodyFatReading[]> {
  const native = getNativeHealthKit();
  if (!native?.isAvailable()) throw new Error('Body-fat history requires Apple Health on iPhone.');
  await native.requestAuthorization(['bodyFatPercentage'], []);
  const start = new Date(now);
  start.setDate(start.getDate() - 180);
  const samples = await native.getQuantitySamples('bodyFatPercentage', start.toISOString(), now.toISOString(), '%', 0, true);
  return samples.map(sample => ({ date: Date.parse(sample.startDate), value: sample.value * 100 }))
    .filter(point => Number.isFinite(point.date) && Number.isFinite(point.value) && point.value > 0 && point.value < 100
      && point.date >= start.getTime() && point.date <= now.getTime())
    .sort((a, b) => a.date - b.date);
}
