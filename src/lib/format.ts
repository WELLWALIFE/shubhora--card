export const inr = (paise: number, opts: { decimals?: boolean } = {}) =>
  `₹${((paise || 0) / 100).toLocaleString("en-IN", {
    minimumFractionDigits: opts.decimals ? 2 : 0,
    maximumFractionDigits: opts.decimals ? 2 : paise % 100 === 0 ? 0 : 2,
  })}`;

export const bvFmt = (bv: number) => bv.toLocaleString("en-IN");

// The server runs on UTC; everything is shown in India time. A plain date (YYYY-MM-DD) is shown as it is.
const IST = "Asia/Kolkata";
export const dateFmt = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  if (typeof d === "string" && d.length === 10) return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const x = typeof d === "string" ? new Date(d) : d;
  return x.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: IST });
};

/** Date and time in India time, e.g. "19 Sept 2026, 11:50 am". */
export const dateTimeFmt = (d: string | Date | null | undefined, opts: { year?: boolean } = { year: true }) => {
  if (!d) return "—";
  const x = typeof d === "string" ? new Date(d) : d;
  return x.toLocaleString("en-IN", { day: "numeric", month: "short", ...(opts.year ? { year: "numeric" } : {}), hour: "numeric", minute: "2-digit", timeZone: IST });
};

export const INCOME_LABEL: Record<string, string> = {
  direct: "Direct Sale Bonus",
  match_new: "Matching Bonus · New sale",
  match_renewal: "Matching Bonus · Renewal",
  sponsor: "Sponsor Bonus",
  rank_reward: "Rank reward",
};

export const LEDGER_LABEL: Record<string, string> = {
  income: "Income", tds: "TDS", admin_charge: "Admin charge", withdrawal: "Withdrawal",
  withdrawal_reversal: "Withdrawal returned", manual_credit: "Credit by company", manual_debit: "Debit by company",
  clawback: "Refund recovery",
};

/** Staff actions from the activity log, in plain words. Unknown actions fall back to the raw name. */
export const ACTION_LABEL: Record<string, string> = {
  "activate.offline": "Made green (paid offline)", "activate.complimentary": "Made green (complimentary)", "renew.offline": "Renewal recorded (offline)",
  "member.blocked": "Block ID changed", "member.income_hold": "Income hold changed", "member.withdraw_block": "Withdrawal block changed",
  "member.show_balance": "Wallet balance visibility changed", "member.edit": "Details edited", "member.link": "App account linked (Super Admin)", "member.unlink": "App account unlinked (Super Admin)", "member.reset_password": "Password reset",
  "member.password_generated": "New password created", "member.login_as": "Staff opened the member panel", "member.register_by_admin": "Registered by staff",
  "wallet.credit": "Wallet credited", "wallet.debit": "Wallet debited", "wallet.adjust_requested": "Wallet change sent for approval",
  "payment.refund": "Payment refunded", "payment.unapplied": "Online payment could not be applied", "kyc.approve": "KYC approved", "kyc.reject": "KYC rejected",
  "kyc.bank_change": "Bank details changed", "withdrawal.approve": "Withdrawal approved", "withdrawal.paid": "Withdrawal paid", "withdrawal.reject": "Withdrawal rejected",
  "withdrawal.request_as_member": "Withdrawal requested by staff for member", "tree.sponsor_change": "Sponsor changed", "tree.placement_move": "Moved in the tree",
  "suite.sync": "Shubhora account synced", "rank_reward.approve": "Rank reward approved", "rank_reward.cancel": "Rank reward cancelled",
  "closing.post": "Daily closing posted", "plan.change": "Plan settings changed", "ranks.update": "Rank table changed", "flag.set": "Show / hide switch changed",
  "company.update": "Company details changed", "staff.create": "Staff login created", "staff.toggle": "Staff login enabled or disabled",
  "news.create": "Announcement published", "news.toggle": "Announcement shown or hidden", "download.add": "Download added", "download.toggle": "Download shown or hidden",
  "report.export": "Report downloaded", "approval.approve": "Wallet change approved", "approval.reject": "Wallet change rejected",
  "payment_request.approve": "Manual payment approved", "payment_request.reject": "Manual payment rejected", "payment_request.submit_as_member": "Manual payment sent by staff for member",
  "admin.password_change": "Staff password changed", "admin.2fa_on": "Two-step login turned on", "admin.2fa_off": "Two-step login turned off",
  "activate.admin": "Made green (admin activation)", "renew.admin": "Renewed (admin activation)",
  "staff.update": "Staff login changed (Super Admin)", "staff.reset_password": "Staff password reset (Super Admin)",
  "staff.2fa_reset": "Staff two-step login reset (Super Admin)", "staff.logout": "Staff logged out everywhere (Super Admin)",
};
export const actionLabel = (a: string) => ACTION_LABEL[a] ?? a;
