import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NewFormClient } from "./new-form-client";

export default async function NewFormPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: membership } = await supabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", user?.id ?? "")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (!membership) {
    redirect("/forms");
  }

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .eq("organization_id", membership.organization_id)
    .order("name");

  return (
    <NewFormClient
      organizationId={membership.organization_id}
      projects={projects ?? []}
    />
  );
}
