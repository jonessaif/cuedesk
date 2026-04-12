export function calculateDurationMinutes(startTime: Date, now: Date): number {
  const diff = now.getTime() - startTime.getTime();
  const minutes = Math.floor(diff / 60000);

  if (minutes < 0) {
    return 0;
  }

  return minutes;
}
