const BUG_BUTTON_HIDDEN_KEY = 'bug_button_hidden_until'

export function getBugButtonHidden(): boolean {
  const hiddenUntil = localStorage.getItem(BUG_BUTTON_HIDDEN_KEY)
  if (!hiddenUntil) return false
  return Date.now() < Number.parseInt(hiddenUntil, 10)
}

export function setBugButtonHidden(days: number = 1): void {
  const hiddenUntil = Date.now() + days * 24 * 60 * 60 * 1000
  localStorage.setItem(BUG_BUTTON_HIDDEN_KEY, hiddenUntil.toString())
}

export function clearBugButtonHidden(): void {
  localStorage.removeItem(BUG_BUTTON_HIDDEN_KEY)
}