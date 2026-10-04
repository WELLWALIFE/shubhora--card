import { redirect } from "next/navigation";
import { getMember } from "@/server/auth/session";

export default async function Home() {
  redirect((await getMember()) ? "/dashboard" : "/login");
}
