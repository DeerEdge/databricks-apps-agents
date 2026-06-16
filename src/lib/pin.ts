// Pure helper: validate/normalize an Indian PIN code from user input. No DOM/DB → testable.
// Indian PINs are exactly 6 digits and never start with 0.

export function normalizePin(input: unknown): string | null {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (digits.length !== 6) return null;
  if (digits[0] === "0") return null;
  return digits;
}
