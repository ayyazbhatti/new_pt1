export function getDaysInMonth(date: Date) {
  const year = date.getFullYear()
  const month = date.getMonth()
  const first = new Date(year, month, 1)
  const last = new Date(year, month + 1, 0)
  const daysInMonth = last.getDate()
  const startingDayOfWeek = first.getDay() // 0 = Sunday
  return { year, month, daysInMonth, startingDayOfWeek }
}

/** Build array of calendar cells: null for leading empty, then 1..daysInMonth */
export function getMonthCalendarCells(date: Date): (number | null)[] {
  const { daysInMonth, startingDayOfWeek } = getDaysInMonth(date)
  const leading = Array(startingDayOfWeek).fill(null)
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  return [...leading, ...days]
}

export function isSameCalendarDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  )
}
