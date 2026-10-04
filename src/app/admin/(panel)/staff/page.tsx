import { db } from "@/server";
import { requireAdmin } from "@/server/auth/session";
import { staffAction, staffToggleAction } from "@/app/actions/admin";
import { ActionForm, Field } from "@/components/forms";
import { PageHead } from "@/components/ui";

export const metadata = { title: "Staff" };

const ROLES: [string, string][] = [
  ["accounts", "Accounts: payments, activations, closing, withdrawals, wallet"],
  ["kyc", "KYC: review KYC only"],
  ["support", "Support: members, tickets, news"],
  ["viewer", "Viewer: see everything, change nothing"],
  ["ca", "CA: reports and payments, view only"],
];

export default async function Staff() {
  const me = await requireAdmin("staff");
  const rows = await (await db()).query<Record<string, unknown>>("select id, username, name, role, active from admins order by id desc");
  return (
    <div className="space-y-6">
      <PageHead title="Staff logins" sub="Give each person their own login with only the access they need." />
      <div className="grid lg:grid-cols-[1fr_360px] gap-6 items-start">
        <div className="card overflow-x-auto">
          <table className="grid-table"><thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Status</th><th></th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={String(r.id)}>
                <td className="font-mono">{r.username as string}</td><td>{r.name as string}</td><td className="capitalize">{r.role as string}</td>
                <td className={r.active ? "text-green font-semibold" : "text-red font-semibold"}>{r.active ? "Active" : "Disabled"}</td>
                <td>{r.role !== "owner" && Number(r.id) !== me.id && (
                  <form action={staffToggleAction}><input type="hidden" name="staff" value={String(r.id)} /><button className="btn btn-ghost text-xs">{r.active ? "Disable" : "Enable"}</button></form>)}</td>
              </tr>))}
            </tbody>
          </table>
        </div>
        <div className="card p-5">
          <p className="font-bold mb-4">Add staff</p>
          <ActionForm action={staffAction} submit="Create login">
            <Field label="Name" name="name" required />
            <Field label="Username" name="username" required />
            <div><label className="label" htmlFor="role">Role</label><select id="role" name="role" className="input">{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <Field label="Password" name="password" type="password" required hint="At least 10 characters" />
          </ActionForm>
        </div>
      </div>
    </div>
  );
}
