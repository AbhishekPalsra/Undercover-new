export type Value =
  string | number | boolean | null | Value[] | { [key: string]: Value };
export interface Claim {
  claim_id: string;
  thread_id: string | null;
  summary: string;
  claim_type: string;
  amount_claimed: number;
  status: string;
  active: boolean;
  story: string;
  incident_date: string;
  incident_location: string;
  submitted_on: string;
  customer: { name: string; previous_claims: Value[] } & Record<string, Value>;
  policy: Record<string, Value>;
  plan: Record<string, Value>;
  add_ons: Value[];
  items: { description: string; amount: number; category: string }[];
  documents: { name: string; type: string; content: string }[];
  decision: {
    outcome: string;
    amount: string;
    calculation: string;
    reason: string;
    policy_section: string;
  } | null;
  payment: { amount: string; time: string } | null;
  sign_off: { name: string; time: string } | null;
  progress: {
    sequence: number;
    thread_id: string;
    action: string;
    message: string;
    time: string;
  }[];
}
export interface Handler {
  handler_id: string;
  name: string;
  can_approve_over_limit: boolean;
}
export interface Instructions {
  text: string;
}
export const money = (value: number | string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number(value),
  );
export const label = (value: string) =>
  (value === "waiting_for_sign_off" ? "Waiting for sign-off" : value)
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
export async function request<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(
    "/api" + path,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  if (!response.ok)
    throw new Error(
      `Request failed (${String(response.status)}). Please try again.`,
    );
  return (await response.json()) as T;
}
